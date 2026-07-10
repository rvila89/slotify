/**
 * Controlador del ARCHIVADO MANUAL de la reserva: `POST /api/reservas/:id/archivar`
 * (US-038 / UC-28 flujo alternativo manual, actor Gestor).
 *
 * Traduce el contrato HTTP (op `archivarReservaManual`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body.
 * El `{id}` de la ruta es la RESERVA en `post_evento` que el Gestor archiva (no es un barrido:
 * es una acción de usuario con JWT, NUNCA `X-Cron-Token`). El `JwtAuthGuard` GLOBAL exige
 * token (401 sin él); aquí se añade `RolesGuard` + `@Roles('gestor')` para que un autenticado
 * SIN rol Gestor reciba 403 sin ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato, gate D-3=3.B):
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
 *   - `TransicionNoPermitidaError` → 409 con `code: 'transicion_no_permitida'` (estado actual
 *     distinto de `post_evento` o carrera perdida — conflicto de estado del agregado).
 *   - `FianzaNoResueltaError` → 422 con `code: 'fianza_no_resuelta'` (precondición de negocio
 *     de fianza incumplida, distinta del conflicto de estado).
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
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
  ArchivarReservaManualUseCase,
  FianzaNoResueltaError,
  ReservaNoEncontradaError,
  TransicionNoPermitidaError,
  type ArchivarReservaManualResultado,
} from '../application/archivar-reserva-manual.use-case';
import { ArchivarReservaManualResponseDto } from './archivar-reserva-manual.dto';

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
export class ArchivarReservaManualController {
  constructor(private readonly servicio: ArchivarReservaManualUseCase) {}

  @Post(':id/archivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archivar manualmente la reserva a reserva_completada (UC-28 / US-038)',
  })
  async archivar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ArchivarReservaManualResponseDto> {
    try {
      const resultado = await this.servicio.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  /**
   * Proyecta la RESERVA hidratada al `allOf(Reserva)` del contrato (sin el `cliente` de
   * ReservaDetalle). Si la relectura post-commit no resolvió (best-effort: puerto no
   * disponible / carrera), cae a la proyección mínima (`idReserva`/`estado`) para no romper la
   * respuesta; QA lo valida contra BD real con la RESERVA hidratada.
   */
  private aResponse(
    resultado: ArchivarReservaManualResultado,
  ): ArchivarReservaManualResponseDto {
    const r = resultado.reserva;
    if (r === null) {
      return {
        idReserva: resultado.reservaId,
        codigo: '',
        clienteId: '',
        estado: resultado.estado,
        subEstado: null,
        canalEntrada: '',
        fechaEvento: null,
        duracionHoras: null,
        tipoEvento: null,
        numAdultosNinosMayores4: null,
        numNinosMenores4: null,
        numInvitadosFinal: null,
        importeTotal: null,
        importeSenal: null,
        importeLiquidacion: null,
        ttlExpiracion: null,
        visitaProgramadaFecha: null,
        visitaProgramadaHora: null,
        visitaRealizada: null,
        fianzaEur: null,
        fianzaCobradaFecha: null,
        fianzaDevueltaFecha: null,
        fianzaDevueltaEur: null,
        condPartFirmadas: null,
        condPartFechaEnvio: null,
        condPartFechaFirma: null,
        preEventoStatus: '',
        liquidacionStatus: '',
        fianzaStatus: '',
        posicionCola: null,
        consultaBloqueanteId: null,
        notas: null,
        fechaCreacion: '',
      };
    }
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
    };
  }

  private aHttp(error: unknown): never {
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof TransicionNoPermitidaError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        code: error.codigo,
      });
    }
    if (error instanceof FianzaNoResueltaError) {
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
