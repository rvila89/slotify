/**
 * Controlador del FORZADO MANUAL del inicio de evento: `POST /api/reservas/:id/forzar-inicio-evento`
 * (US-032 / UC-23 FA-01, actor Gestor).
 *
 * Traduce el contrato HTTP (op `forzarInicioEvento`) ↔ comando de aplicación. El `tenant_id` y
 * el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body (D-1). El
 * `{id}` de la ruta es la RESERVA en `reserva_confirmada` que el Gestor fuerza. Autorización:
 * es una acción del GESTOR (JWT de usuario, NO `X-Cron-Token`). El `JwtAuthGuard` GLOBAL
 * (APP_GUARD) exige token (401 sin él); aquí se añade `RolesGuard` + `@Roles('gestor')` para
 * que un autenticado SIN rol Gestor reciba 403 sin ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
 *   - `ConflictoEstadoError` → 409 con `code: 'conflicto_estado'` (estado != reserva_confirmada
 *     o carrera perdida bajo el lock: cron llegó primero / doble sesión).
 *   - `FechaEventoNoEsHoyError` → 422 con `code: 'fecha_evento_no_es_hoy'` (estado
 *     reserva_confirmada pero fecha_evento != hoy).
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
  ConflictoEstadoError,
  FechaEventoNoEsHoyError,
  ForzarInicioEventoUseCase,
  ReservaNoEncontradaError,
  type ForzarInicioEventoResultado,
} from '../application/forzar-inicio-evento.use-case';
import { ForzarInicioEventoResponseDto } from './forzar-inicio-evento.dto';

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
export class ForzarInicioEventoController {
  constructor(private readonly servicio: ForzarInicioEventoUseCase) {}

  @Post(':id/forzar-inicio-evento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forzar el inicio de evento asumiendo el riesgo (UC-23 FA-01 / US-032)',
  })
  async forzar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ForzarInicioEventoResponseDto> {
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
   * Compone la respuesta 200 `allOf(Reserva) + { forzadoPorGestor, precondicionesIncumplidas }`:
   * hidrata la RESERVA COMPLETA re-leída post-commit (`resultado.reserva`) y superpone la
   * bandera de override y la lista de precondiciones. Si la relectura no resolvió (best-effort:
   * puerto no disponible / carrera), cae a la proyección mínima (`idReserva`/`estado`) para no
   * romper la respuesta; QA lo validará contra BD real con la RESERVA hidratada.
   */
  private aResponse(
    resultado: ForzarInicioEventoResultado,
  ): ForzarInicioEventoResponseDto {
    return {
      ...this.aReservaResponse(resultado),
      forzadoPorGestor: resultado.forzadoPorGestor,
      precondicionesIncumplidas: resultado.precondicionesIncumplidas,
    };
  }

  /** Proyecta la RESERVA hidratada al `allOf(Reserva)` del contrato (sin el `cliente` de ReservaDetalle). */
  private aReservaResponse(
    resultado: ForzarInicioEventoResultado,
  ): Omit<
    ForzarInicioEventoResponseDto,
    'forzadoPorGestor' | 'precondicionesIncumplidas'
  > {
    const r = resultado.reserva;
    if (r === null) {
      // Fallback defensivo (best-effort): la relectura post-commit no resolvió. Se conservan
      // los campos requeridos disponibles; el resto queda vacío. No debería ocurrir con BD real.
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
        fianzaComprobanteFecha: null,
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
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof ConflictoEstadoError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        code: error.codigo,
      });
    }
    if (error instanceof FechaEventoNoEsHoyError) {
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
