/**
 * Controlador de la extensión manual del TTL: `POST /api/reservas/:id/extender-bloqueo`
 * (US-006 / UC-05).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. Tras la extensión, RE-LEE la RESERVA (`ObtenerReservaUseCase`) para
 * devolver el recurso `Reserva` completo con el `ttlExpiracion` NUEVO (estado/subEstado
 * sin cambios). Mapeo de errores de dominio:
 *   - `BloqueoNoExtensibleError` → 409 con `{ motivo }` (esquema `ExtenderBloqueoConflictoError`).
 *   - `ExtenderBloqueoValidacionError` → 422 (estado no extensible 2a/terminal o dias inválido).
 *   - `ReservaNoEncontradaError` → 404.
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
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
  ExtenderBloqueoUseCase,
  ExtenderBloqueoValidacionError,
  BloqueoNoExtensibleError,
  ReservaNoEncontradaError,
  type ExtenderBloqueoComando,
} from '../application/extender-bloqueo.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import { ExtenderBloqueoRequestDto } from './extender-bloqueo.dto';
import { ReservaDetalleResponseDto } from './reserva-detalle.dto';

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`); null si ausente. */
const aFecha = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class ExtenderBloqueoController {
  constructor(
    private readonly useCase: ExtenderBloqueoUseCase,
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Post(':id/extender-bloqueo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Extender plazo del bloqueo blando — prórroga pura del TTL (UC-05 / US-006)',
  })
  async extenderBloqueo(
    @Param('id') id: string,
    @Body() dto: ExtenderBloqueoRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaDetalleResponseDto> {
    const comando: ExtenderBloqueoComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      dias: dto.dias,
    };

    try {
      await this.useCase.ejecutar(comando);
      const detalle = await this.obtenerReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return this.aResponse(detalle);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aHttp(error: unknown): never {
    if (error instanceof BloqueoNoExtensibleError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.motivo,
        motivo: error.motivo,
      });
    }
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof ExtenderBloqueoValidacionError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    throw error;
  }

  private aResponse(r: ReservaDetalleLectura): ReservaDetalleResponseDto {
    return {
      idReserva: r.idReserva,
      codigo: r.codigo,
      clienteId: r.clienteId,
      estado: r.estado,
      subEstado: r.subEstado,
      canalEntrada: r.canalEntrada,
      fechaEvento: aFecha(r.fechaEvento),
      duracionHoras: r.duracionHoras,
      tipoEvento: r.tipoEvento,
      numAdultosNinosMayores4: r.numAdultosNinosMayores4,
      numNinosMenores4: r.numNinosMenores4,
      numInvitadosFinal: r.numInvitadosFinal,
      importeTotal: r.importeTotal,
      importeSenal: r.importeSenal,
      importeLiquidacion: r.importeLiquidacion,
      ttlExpiracion: aFechaHora(r.ttlExpiracion),
      visitaProgramadaFecha: aFecha(r.visitaProgramadaFecha),
      visitaProgramadaHora: r.visitaProgramadaHora,
      visitaRealizada: r.visitaRealizada,
      fianzaEur: r.fianzaEur,
      fianzaCobradaFecha: aFecha(r.fianzaCobradaFecha),
      fianzaDevueltaFecha: aFecha(r.fianzaDevueltaFecha),
      fianzaComprobanteFecha: aFechaHora(r.fianzaComprobanteFecha),
      condPartFirmadas: r.condPartFirmadas,
      condPartFechaEnvio: aFechaHora(r.condPartFechaEnvio),
      condPartFechaFirma: aFechaHora(r.condPartFechaFirma),
      preEventoStatus: r.preEventoStatus,
      liquidacionStatus: r.liquidacionStatus,
      fianzaStatus: r.fianzaStatus,
      posicionCola: r.posicionCola,
      consultaBloqueanteId: r.consultaBloqueanteId,
      notas: r.notas,
      comentarios: r.comentarios,
      fechaCreacion: r.fechaCreacion.toISOString(),
      cliente: {
        idCliente: r.cliente.idCliente,
        nombre: r.cliente.nombre,
        apellidos: r.cliente.apellidos,
        email: r.cliente.email,
        telefono: r.cliente.telefono,
        dniNif: r.cliente.dniNif,
        direccion: r.cliente.direccion,
        codigoPostal: r.cliente.codigoPostal,
        poblacion: r.cliente.poblacion,
        provincia: r.cliente.provincia,
      },
    };
  }
}
