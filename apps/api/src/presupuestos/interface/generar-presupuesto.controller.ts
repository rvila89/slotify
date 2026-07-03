/**
 * Controlador de la generación del presupuesto / activación de la pre_reserva
 * (US-014 / UC-14):
 *   - `POST /reservas/{id}/presupuesto/preview` → 200 (calcula borrador, no persiste).
 *   - `POST /reservas/{id}/presupuesto` → 201 (confirma en tx única).
 *
 * Traduce el contrato HTTP (congelado) ↔ comando de aplicación. El `tenant_id` y el
 * `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body. Mapeo de
 * errores de dominio (F5-02):
 *   - 409: `OrigenInvalidoError`, `PresupuestoYaExisteError`, `FechaYaBloqueadaError`
 *          / colisión `P2002` del UNIQUE(tenant,fecha) (carrera D4).
 *   - 422: `DatosFiscalesIncompletosError` (+ camposFaltantes), `PrecioManualRequeridoError`,
 *          `TarifaNoConfiguradaError`, `TemporadaNoConfiguradaError`.
 *   - 404: `ReservaNoEncontradaError`.
 */
import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  GenerarPresupuestoUseCase,
  DatosFiscalesIncompletosError,
  OrigenInvalidoError,
  PrecioManualRequeridoError,
  PresupuestoYaExisteError,
  ReservaNoEncontradaError,
  type ConfirmarPresupuestoComando,
  type ConfirmarPresupuestoResultado,
  type PresupuestoExtraInput,
  type PreviewPresupuestoComando,
  type PreviewPresupuestoResultado,
} from '../application/generar-presupuesto.use-case';
import {
  TarifaNoConfiguradaError,
  TemporadaNoConfiguradaError,
  ValidacionTarifaError,
} from '../../tarifas/domain/calculadora-tarifa.service';
import {
  FechaYaBloqueadaError,
} from '../../reservas/domain/bloquear-fecha.service';
import {
  ConfirmarPresupuestoRequestDto,
  ConfirmarPresupuestoResponseDto,
  PresupuestoPreviewResponseDto,
  PreviewPresupuestoRequestDto,
} from './generar-presupuesto.dto';

@ApiTags('Presupuestos')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class GenerarPresupuestoController {
  constructor(private readonly useCase: GenerarPresupuestoUseCase) {}

  @Post(':id/presupuesto/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calcular borrador del presupuesto sin persistir (UC-14 / US-014)',
  })
  async previewPresupuesto(
    @Param('id') id: string,
    @Body() dto: PreviewPresupuestoRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<PresupuestoPreviewResponseDto> {
    const comando: PreviewPresupuestoComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      extras: this.aExtras(dto.extras),
      ...(dto.descuentoEur !== undefined ? { descuentoEur: dto.descuentoEur } : {}),
      ...(dto.precioManualEur !== undefined
        ? { precioManualEur: dto.precioManualEur }
        : {}),
    };
    try {
      return this.aPreviewResponse(await this.useCase.preview(comando));
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/presupuesto')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirmar presupuesto y activar pre-reserva (UC-14 / US-014)',
  })
  async confirmarPresupuesto(
    @Param('id') id: string,
    @Body() dto: ConfirmarPresupuestoRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ConfirmarPresupuestoResponseDto> {
    const comando: ConfirmarPresupuestoComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      extras: this.aExtras(dto.extras),
      ...(dto.descuentoEur !== undefined ? { descuentoEur: dto.descuentoEur } : {}),
      ...(dto.descuentoMotivo !== undefined
        ? { descuentoMotivo: dto.descuentoMotivo }
        : {}),
      ...(dto.precioManualEur !== undefined
        ? { precioManualEur: dto.precioManualEur }
        : {}),
    };
    try {
      return this.aConfirmarResponse(id, await this.useCase.confirmar(comando));
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aExtras(
    extras: ConfirmarPresupuestoRequestDto['extras'],
  ): PresupuestoExtraInput[] {
    return (extras ?? []).map((e) => ({ extra_id: e.extra_id, cantidad: e.cantidad }));
  }

  private aPreviewResponse(
    resultado: PreviewPresupuestoResultado,
  ): PresupuestoPreviewResponseDto {
    return {
      tarifaAConsultar: resultado.tarifaAConsultar,
      tarifa: resultado.tarifa,
      extrasTotalEur: resultado.extrasTotalEur,
      descuentoEur: resultado.descuentoEur,
      desglose: resultado.desglose,
      reparto: resultado.reparto,
    };
  }

  private aConfirmarResponse(
    reservaId: string,
    resultado: ConfirmarPresupuestoResultado,
  ): ConfirmarPresupuestoResponseDto {
    return {
      presupuesto: resultado.presupuesto,
      tarifaId: resultado.tarifaId,
      reparto: resultado.reparto,
      reserva: {
        idReserva: reservaId,
        estado: 'pre_reserva',
        ttlExpiracion: resultado.ttlExpiracion.toISOString(),
      },
      consultasDescartadas: resultado.consultasDescartadas,
    };
  }

  private aHttp(error: unknown): never {
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof OrigenInvalidoError ||
      error instanceof PresupuestoYaExisteError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (error instanceof FechaYaBloqueadaError || this.esColisionUnique(error)) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Fecha no disponible',
        codigo: 'FECHA_NO_DISPONIBLE',
        motivo: 'Fecha no disponible',
      });
    }
    if (error instanceof DatosFiscalesIncompletosError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
        camposFaltantes: error.camposFaltantes,
      });
    }
    if (error instanceof PrecioManualRequeridoError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof TarifaNoConfiguradaError ||
      error instanceof TemporadaNoConfiguradaError ||
      error instanceof ValidacionTarifaError
    ) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
      });
    }
    throw error;
  }

  /** ¿Es un `P2002` (violación de UNIQUE) que indica carrera D4 sobre la fecha? */
  private esColisionUnique(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    );
  }
}
