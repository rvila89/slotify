/**
 * Controlador del DESCARTE POR CLIENTE: `POST /api/reservas/:id/descartar` (US-013 / UC-10 /
 * A17, actor Gestor "en nombre del cliente").
 *
 * Traduce el contrato HTTP (op `descartarConsultaPorCliente`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body.
 * El `{id}` de la ruta es la RESERVA de consulta activa que el Gestor descarta (acción de
 * usuario con JWT, NUNCA `X-Cron-Token`). El `JwtAuthGuard` GLOBAL exige token (401 sin él);
 * aquí se añade `RolesGuard` + `@Roles('gestor')` para que un autenticado SIN rol Gestor reciba
 * 403 sin ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ReservaNoEncontradaDescarteError` → 404 (inexistente / otro tenant bajo RLS).
 *   - `DescarteEstadoTerminalError` → 409 con `code: 'transicion_no_permitida'` (origen
 *     terminal / doble descarte / carrera perdida contra el TTL) — NO 422.
 *   - Cualquier otro error se relanza al filtro global.
 *
 * La respuesta 200 devuelve la RESERVA (`Reserva`) re-leída tras el commit (bajo RLS) para
 * hidratar el objeto del contrato (misma lectura que `GET /reservas/{id}`, sin el `cliente`).
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  DescarteEstadoTerminalError,
  ReservaNoEncontradaDescarteError,
} from '../application/descartar-consulta-por-cliente.use-case';
import { DescartarReservaOrquestadorUseCase } from '../application/descartar-reserva-orquestador.use-case';
import {
  DescartePreReservaEstadoTerminalError,
  DescartePreReservaOrigenInvalidoError,
  ReservaNoEncontradaError,
} from '../application/descartar-prereserva.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import {
  DescartarConsultaRequestDto,
  DescartarConsultaResponseDto,
} from './descartar-consulta.dto';

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`); null si ausente. */
const aFecha = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

@ApiTags('Reservas')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class DescartarConsultaController {
  constructor(
    private readonly servicio: DescartarReservaOrquestadorUseCase,
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Post(':id/descartar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Descartar una reserva: consulta {2a|2b|2c|2d|2v}→2z (US-013) o pre_reserva→reserva_cancelada (D-2) según su estado',
  })
  async descartar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() body: DescartarConsultaRequestDto,
  ): Promise<DescartarConsultaResponseDto> {
    try {
      await this.servicio.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        motivo: body?.motivo,
      });
      const detalle = await this.obtenerReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return this.aResponse(detalle);
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Proyecta la RESERVA hidratada al `Reserva` del contrato (sin el `cliente` de ReservaDetalle). */
  private aResponse(r: ReservaDetalleLectura): DescartarConsultaResponseDto {
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
      fechaCreacion: r.fechaCreacion.toISOString(),
    };
  }

  private aHttp(error: unknown): never {
    // 404 — RESERVA invisible bajo RLS (consulta US-013 o pre-reserva D-2).
    if (
      error instanceof ReservaNoEncontradaDescarteError ||
      error instanceof ReservaNoEncontradaError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    // 409 — origen terminal / carrera perdida (consulta US-013 o pre-reserva D-2).
    if (
      error instanceof DescarteEstadoTerminalError ||
      error instanceof DescartePreReservaEstadoTerminalError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        code: error.codigo,
      });
    }
    // 422 — la RESERVA no está en pre_reserva (ni consulta): origen inválido (D-2).
    if (error instanceof DescartePreReservaOrigenInvalidoError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        code: error.codigo,
      });
    }
    throw error;
  }
}
