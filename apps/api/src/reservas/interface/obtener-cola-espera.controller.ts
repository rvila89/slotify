/**
 * Controlador de lectura de la cola de espera: `GET /api/reservas/:id/cola` →
 * `ColaEsperaResponse` (vista de cola US-017 / UC-11).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ query de aplicación. El
 * `tenant_id` SIEMPRE deriva del JWT (`@CurrentUser`), nunca del path/body; el guard
 * de auth global (`JwtAuthGuard`) protege el endpoint (401 sin token). Mapeo de
 * errores: `ColaEsperaNoEncontradaError` → 404 (reserva inexistente / de otro tenant,
 * invisible por RLS). FA-04 (reserva sin FECHA_BLOQUEADA) NO es error: 200 con
 * `estaBloqueada:false`.
 *
 * Lectura pura: no muta estado. Los derivados temporales ya vienen calculados por el
 * adaptador sobre instantes; aquí solo se serializan los instantes crudos a ISO.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ColaEsperaNoEncontradaError,
  ObtenerColaEsperaUseCase,
  type ColaEsperaLectura,
} from '../application/obtener-cola-espera.query';
import { ColaEsperaResponseDto } from './cola-espera.dto';

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`); null si ausente. */
const aFecha = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

@ApiTags('Cola')
@ApiBearerAuth()
@Controller('reservas')
export class ObtenerColaEsperaController {
  constructor(private readonly useCase: ObtenerColaEsperaUseCase) {}

  @Get(':id/cola')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Visualizar cola de espera de una fecha (UC-11 / US-017)',
  })
  async obtener(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ColaEsperaResponseDto> {
    try {
      const cola = await this.useCase.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return this.aResponse(cola);
    } catch (error) {
      if (error instanceof ColaEsperaNoEncontradaError) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: error.message,
        });
      }
      throw error;
    }
  }

  private aResponse(c: ColaEsperaLectura): ColaEsperaResponseDto {
    return {
      estaBloqueada: c.estaBloqueada,
      bloqueante:
        c.bloqueante === null
          ? null
          : {
              idReserva: c.bloqueante.idReserva,
              codigo: c.bloqueante.codigo,
              clienteNombre: c.bloqueante.clienteNombre,
              subEstado: c.bloqueante.subEstado,
              ttlExpiracion: aFechaHora(c.bloqueante.ttlExpiracion),
              ttlRestante: c.bloqueante.ttlRestante,
              visitaProgramadaFecha: aFecha(c.bloqueante.visitaProgramadaFecha),
            },
      cola: c.cola.map((item) => ({
        idReserva: item.idReserva,
        codigo: item.codigo,
        clienteNombre: item.clienteNombre,
        posicionCola: item.posicionCola,
        fechaCreacion: item.fechaCreacion.toISOString(),
        tiempoEnCola: item.tiempoEnCola,
      })),
    };
  }
}
