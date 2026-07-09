/**
 * Controlador de la FINALIZACIÓN MANUAL del evento: `POST /api/reservas/:id/finalizar-evento`
 * (US-034 / UC-25, actor Gestor).
 *
 * Traduce el contrato HTTP (op `finalizarEvento`) ↔ comando de aplicación. El `tenant_id` y
 * el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body (D-3). El
 * `{id}` de la ruta es la RESERVA en `evento_en_curso` que el Gestor finaliza. Autorización:
 * es una acción del GESTOR (JWT de usuario, NO `X-Cron-Token`). El `JwtAuthGuard` GLOBAL
 * (APP_GUARD) exige token (401 sin él); aquí se añade `RolesGuard` + `@Roles('gestor')` para
 * que un autenticado SIN rol Gestor reciba 403 sin ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
 *   - `TransicionNoPermitidaError` → 409 con `code: 'transicion_no_permitida'` (estado
 *     actual distinto de `evento_en_curso` o carrera de doble finalización perdida, D-8).
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  FinalizarEventoUseCase,
  ReservaNoEncontradaError,
  TransicionNoPermitidaError,
  type FinalizarEventoResultado,
} from '../application/finalizar-evento.use-case';
import { FinalizarEventoResponseDto } from './finalizar-evento.dto';

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
export class FinalizarEventoController {
  constructor(private readonly servicio: FinalizarEventoUseCase) {}

  @Post(':id/finalizar-evento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finalizar evento y disparar solicitud de IBAN (UC-25 / US-034)',
  })
  async finalizar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FinalizarEventoResponseDto> {
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
   * Compone la respuesta 200 `allOf(Reserva) + { e5, documentacionPendiente }`: hidrata la
   * RESERVA COMPLETA re-leída post-commit (`resultado.reserva`) y superpone el resultado del
   * disparo de E5 y la advertencia de documentación. Si la relectura no resolvió (best-effort:
   * puerto no disponible / carrera), cae a la proyección mínima (`idReserva`/`estado`) para no
   * romper la respuesta; QA lo validará contra BD real con la RESERVA hidratada.
   */
  private aResponse(resultado: FinalizarEventoResultado): FinalizarEventoResponseDto {
    return {
      ...this.aReservaResponse(resultado),
      e5: {
        resultado: resultado.e5.resultado,
        comunicacionId: resultado.e5.comunicacionId,
      },
      documentacionPendiente: resultado.documentacionPendiente,
    };
  }

  /** Proyecta la RESERVA hidratada al `allOf(Reserva)` del contrato (sin el `cliente` de ReservaDetalle). */
  private aReservaResponse(
    resultado: FinalizarEventoResultado,
  ): Omit<FinalizarEventoResponseDto, 'e5' | 'documentacionPendiente'> {
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
    throw error;
  }
}
