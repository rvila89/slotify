/**
 * Controlador de la transición «programar visita»: `POST /api/reservas/:id/visita`
 * (US-008 / UC-07).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. Tras la transición, RE-LEE la RESERVA (`ObtenerReservaUseCase`) para
 * devolver el recurso `Reserva` completo (subEstado='2v', visitaProgramada*,
 * visitaRealizada=false, ttlExpiracion nuevo). Mapeo de errores de dominio:
 *   - `VisitaEnColaError` → 409 con `{ motivo }` (esquema `ProgramarVisitaConflictoError`).
 *   - `ProgramarVisitaValidacionError` → 422 (guarda de origen / 2a sin fecha / ventana).
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
  ProgramarVisitaUseCase,
  ProgramarVisitaValidacionError,
  VisitaEnColaError,
  ReservaNoEncontradaError,
  type ProgramarVisitaComando,
} from '../application/programar-visita.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import { ProgramarVisitaRequestDto } from './programar-visita.dto';
import { ReservaDetalleResponseDto } from './reserva-detalle.dto';

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`); null si ausente. */
const aFecha = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

/** Parsea una fecha `YYYY-MM-DD` a `Date` en medianoche UTC (DATE sin hora). */
const parsearFechaUtc = (fecha: string): Date => new Date(`${fecha}T00:00:00.000Z`);

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class ProgramarVisitaController {
  constructor(
    private readonly useCase: ProgramarVisitaUseCase,
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Post(':id/visita')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Programar visita al espacio — transición 2.a/2.b/2.c→2.v (UC-07 / US-008)',
  })
  async programarVisita(
    @Param('id') id: string,
    @Body() dto: ProgramarVisitaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaDetalleResponseDto> {
    const comando: ProgramarVisitaComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      fechaVisita: parsearFechaUtc(dto.fecha),
      horaVisita: dto.hora,
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
    if (error instanceof VisitaEnColaError) {
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
    if (error instanceof ProgramarVisitaValidacionError) {
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
      fianzaDevueltaEur: r.fianzaDevueltaEur,
      condPartFirmadas: r.condPartFirmadas,
      condPartFechaEnvio: aFechaHora(r.condPartFechaEnvio),
      condPartFechaFirma: aFechaHora(r.condPartFechaFirma),
      preEventoStatus: r.preEventoStatus,
      liquidacionStatus: r.liquidacionStatus,
      fianzaStatus: r.fianzaStatus,
      posicionCola: r.posicionCola,
      consultaBloqueanteId: r.consultaBloqueanteId,
      notas: r.notas,
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
        ibanDevolucion: r.cliente.ibanDevolucion,
      },
    };
  }
}
