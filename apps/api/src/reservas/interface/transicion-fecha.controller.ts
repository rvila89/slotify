/**
 * Controlador de la transición «añadir fecha»: `POST /api/reservas/:id/fecha`
 * (US-005 / UC-04).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. Mapeo de errores de dominio (D-7):
 *   - `AsignarFechaConflictoError` → 409 con `{ colaDisponible, motivo }` añadidos al
 *     envelope estándar (esquema `AsignarFechaConflictoError` del contrato).
 *   - `TransicionFechaValidacionError` `tipo:'fecha'` → 400; `tipo:'guarda'` → 422.
 *   - `ReservaNoEncontradaError` → 404.
 *   - Cualquier otro error (incl. `P2002` residual) se relanza al filtro global.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  TransicionFechaUseCase,
  AsignarFechaConflictoError,
  ReservaNoEncontradaError,
  TransicionFechaValidacionError,
  type TransicionFechaComando,
  type ReservaTransicion,
} from '../application/transicion-fecha.use-case';
import {
  AsignarFechaRequestDto,
  AsignarFechaResponseDto,
} from './asignar-fecha.dto';

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class TransicionFechaController {
  constructor(private readonly useCase: TransicionFechaUseCase) {}

  @Post(':id/fecha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Asignar fecha a una consulta exploratoria — transición 2.a→2.b/2.d (UC-04 / US-005)',
  })
  async asignarFecha(
    @Param('id') id: string,
    @Body() dto: AsignarFechaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<AsignarFechaResponseDto> {
    const comando: TransicionFechaComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      fechaEvento: new Date(dto.fechaEvento),
      ...(dto.aceptarCola !== undefined ? { aceptarCola: dto.aceptarCola } : {}),
    };

    try {
      const resultado = await this.useCase.ejecutar(comando);
      return this.aResponse(resultado.reserva);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aResponse(reserva: ReservaTransicion): AsignarFechaResponseDto {
    return {
      idReserva: reserva.idReserva,
      clienteId: reserva.clienteId,
      estado: reserva.estado,
      subEstado: reserva.subEstado,
      fechaEvento: reserva.fechaEvento
        ? reserva.fechaEvento.toISOString().slice(0, 10)
        : null,
      ttlExpiracion: reserva.ttlExpiracion
        ? reserva.ttlExpiracion.toISOString()
        : null,
      posicionCola: reserva.posicionCola ?? null,
      consultaBloqueanteId: reserva.consultaBloqueanteId ?? null,
    };
  }

  private aHttp(error: unknown): never {
    if (error instanceof AsignarFechaConflictoError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.motivo ?? error.message,
        colaDisponible: error.colaDisponible,
        motivo: error.motivo ?? error.message,
      });
    }
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof TransicionFechaValidacionError) {
      if (error.tipo === 'fecha') {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: error.message,
        });
      }
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    throw error;
  }
}
