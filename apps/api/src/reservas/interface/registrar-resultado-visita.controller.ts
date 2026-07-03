/**
 * Controlador del registro del resultado de la visita:
 * `PATCH /api/reservas/:id/visita` (UC-08). Soporta «cliente interesado» (US-009,
 * `2.v → 2.b`) y «reserva inmediata» (US-010, `2.v → pre_reserva`).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. Tras la transición, RE-LEE la RESERVA (`ObtenerReservaUseCase`) para
 * devolver el recurso `Reserva` completo (2.b + visitaRealizada + TTL fresco en
 * «interesado»; pre_reserva + subEstado=null + TTL 7d en «reserva inmediata»). Mapeo
 * de errores de dominio:
 *   - `ResultadoVisitaValidacionError` → 422 (guarda de origen / resultado no soportado).
 *   - `DatosObligatoriosIncompletosError` → 422 con `codigo='DATOS_FISCALES_INCOMPLETOS'`
 *     y `camposFaltantes` (datos UC-14 incompletos para la reserva inmediata).
 *   - `ReservaNoEncontradaError` → 404.
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  RegistrarResultadoVisitaUseCase,
  ResultadoVisitaValidacionError,
  ReservaNoEncontradaError,
  DatosObligatoriosIncompletosError,
  type RegistrarResultadoVisitaComando,
  type ResultadoVisita,
} from '../application/registrar-resultado-visita.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import { RegistrarResultadoVisitaRequestDto } from './registrar-resultado-visita.dto';
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
export class RegistrarResultadoVisitaController {
  constructor(
    private readonly useCase: RegistrarResultadoVisitaUseCase,
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Patch(':id/visita')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Registrar resultado de visita — "cliente interesado" (2.v→2.b, US-009) o "reserva inmediata" (2.v→pre_reserva, US-010) (UC-08)',
    operationId: 'registrarResultadoVisita',
  })
  @ApiResponse({ status: 200, description: 'RESERVA actualizada (2.b, visita realizada, TTL fresco).' })
  @ApiResponse({ status: 400, description: 'Cuerpo mal formado (resultado ausente o fuera del enum).' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Sin permisos.' })
  @ApiResponse({ status: 404, description: 'RESERVA inexistente para el tenant.' })
  @ApiResponse({ status: 422, description: 'Guarda de origen (no en 2.v) o resultado no soportado.' })
  async registrarResultadoVisita(
    @Param('id') id: string,
    @Body() dto: RegistrarResultadoVisitaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaDetalleResponseDto> {
    const comando: RegistrarResultadoVisitaComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      // El contrato soporta `interesado` (US-009) y `reserva_inmediata` (US-010). El
      // valor `descarta` (US-011) no está en la unión del dominio, así que el use-case
      // lo trata como resultado no soportado (422).
      resultado: dto.resultado as ResultadoVisita,
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
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof DatosObligatoriosIncompletosError) {
      // UC-14 (D-4): datos obligatorios incompletos → 422 con la lista de faltantes,
      // que el filtro global propaga al envelope (`camposFaltantes`).
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
        camposFaltantes: error.camposFaltantes,
      });
    }
    if (error instanceof ResultadoVisitaValidacionError) {
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
