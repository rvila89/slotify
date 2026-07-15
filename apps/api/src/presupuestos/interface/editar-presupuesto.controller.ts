/**
 * Controlador de la EDICIÓN/REENVÍO del presupuesto en pre_reserva (US-015 / UC-15):
 *   - `POST /reservas/{id}/presupuesto/edicion/preview` → 200 (recalcula, no persiste).
 *   - `POST /reservas/{id}/presupuesto/edicion` → 201 (crea nueva versión).
 *   - `POST /reservas/{id}/presupuesto/reenvio` → 200 (reenvío sin cambios).
 *
 * Traduce el contrato HTTP ↔ comando de aplicación. El `tenant_id`/`usuario_id`
 * SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body. Rol `gestor`. Mapeo
 * de errores de dominio (igual que US-014):
 *   - 409: `ReservaFueraDePrereservaError`, `PresupuestoNoEditableError`.
 *   - 422: `PrecioManualRequeridoError`, `DescuentoInvalidoError`,
 *          `DuracionInvalidaError`, `MetodoPagoRequeridoError`,
 *          `TarifaNoConfiguradaError`, `TemporadaNoConfiguradaError`.
 *   - 404: `ReservaNoEncontradaError`, `PresupuestoVigenteNoEncontradoError`.
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
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  DescuentoInvalidoError,
  DuracionInvalidaError,
  EditarPresupuestoUseCase,
  MetodoPagoRequeridoError,
  PrecioManualRequeridoError,
  PresupuestoNoEditableError,
  PresupuestoVigenteNoEncontradoError,
  ReenviarPresupuestoUseCase,
  ReservaFueraDePrereservaError,
  ReservaNoEncontradaError,
  type EdicionExtraInput,
  type EditarPresupuestoConfirmarComando,
  type EditarPresupuestoPreviewComando,
  type ReenviarPresupuestoComando,
} from '../application/editar-presupuesto.use-case';
import {
  TarifaNoConfiguradaError,
  TemporadaNoConfiguradaError,
  ValidacionTarifaError,
} from '../../tarifas/domain/calculadora-tarifa.service';
import {
  EdicionExtraInputDto,
  EdicionPresupuestoPreviewRequestDto,
  EdicionPresupuestoRequestDto,
  ReenviarPresupuestoRequestDto,
} from './editar-presupuesto.dto';

@ApiTags('Presupuestos')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class EditarPresupuestoController {
  constructor(
    private readonly editarUseCase: EditarPresupuestoUseCase,
    private readonly reenviarUseCase: ReenviarPresupuestoUseCase,
  ) {}

  @Post(':id/presupuesto/edicion/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recalcular el borrador de la edición sin persistir (UC-15 / US-015)',
  })
  async previewEdicion(
    @Param('id') id: string,
    @Body() dto: EdicionPresupuestoPreviewRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<unknown> {
    const comando: EditarPresupuestoPreviewComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      metodoPago: dto.metodoPago,
      extras: this.aExtras(dto.extras),
      ...(dto.numAdultosNinosMayores4 !== undefined
        ? { numAdultosNinosMayores4: dto.numAdultosNinosMayores4 }
        : {}),
      ...(dto.duracionHoras !== undefined ? { duracionHoras: dto.duracionHoras } : {}),
      ...(dto.descuentoEur !== undefined ? { descuentoEur: dto.descuentoEur } : {}),
      ...(dto.descuentoMotivo !== undefined
        ? { descuentoMotivo: dto.descuentoMotivo }
        : {}),
      ...(dto.precioManualEur !== undefined
        ? { precioManualEur: dto.precioManualEur }
        : {}),
    };
    try {
      return await this.editarUseCase.preview(comando);
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/presupuesto/edicion')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirmar la edición y crear nueva versión del presupuesto (UC-15)',
  })
  async editar(
    @Param('id') id: string,
    @Body() dto: EdicionPresupuestoRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<unknown> {
    const comando: EditarPresupuestoConfirmarComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      metodoPago: dto.metodoPago,
      extras: this.aExtras(dto.extras),
      enviar: dto.enviar,
      ...(dto.numAdultosNinosMayores4 !== undefined
        ? { numAdultosNinosMayores4: dto.numAdultosNinosMayores4 }
        : {}),
      ...(dto.duracionHoras !== undefined ? { duracionHoras: dto.duracionHoras } : {}),
      ...(dto.descuentoEur !== undefined ? { descuentoEur: dto.descuentoEur } : {}),
      ...(dto.descuentoMotivo !== undefined
        ? { descuentoMotivo: dto.descuentoMotivo }
        : {}),
      ...(dto.precioManualEur !== undefined
        ? { precioManualEur: dto.precioManualEur }
        : {}),
    };
    try {
      return await this.editarUseCase.confirmar(comando);
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/presupuesto/reenvio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar la versión vigente del presupuesto sin cambios (UC-15)',
  })
  async reenviar(
    @Param('id') id: string,
    @Body() _dto: ReenviarPresupuestoRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<unknown> {
    const comando: ReenviarPresupuestoComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
    };
    try {
      return await this.reenviarUseCase.ejecutar(comando);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aExtras(extras: EdicionExtraInputDto[] | undefined): EdicionExtraInput[] {
    return (extras ?? []).map((e) => ({
      cantidad: e.cantidad,
      ...(e.extraId !== undefined ? { extra_id: e.extraId } : {}),
      ...(e.conceptoLibre !== undefined ? { concepto_libre: e.conceptoLibre } : {}),
    }));
  }

  private aHttp(error: unknown): never {
    if (
      error instanceof ReservaNoEncontradaError ||
      error instanceof PresupuestoVigenteNoEncontradoError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof ReservaFueraDePrereservaError ||
      error instanceof PresupuestoNoEditableError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (
      error instanceof PrecioManualRequeridoError ||
      error instanceof DescuentoInvalidoError ||
      error instanceof DuracionInvalidaError ||
      error instanceof MetodoPagoRequeridoError ||
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
}
