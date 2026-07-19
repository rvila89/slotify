/**
 * Controlador de la operación atómica «cambiar fecha ya bloqueada»:
 * `POST /api/reservas/:id/cambiar-fecha` (US-051 §Punto 2 / §D-2.1).
 *
 * Traduce el contrato HTTP (op `CambiarFechaRequest` → `Reserva`) ↔ comando de aplicación.
 * El `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del
 * path/body. Tras el commit RE-LEE la RESERVA (bajo RLS) reusando `GET /reservas/{id}`
 * para devolver el `Reserva` completo con la nueva `fechaEvento`.
 *
 * Mapeo de errores de dominio a códigos (contrato, F5-02: 409 = ocupación, 422 = guarda):
 *   - `CambiarFechaConflictoError` → 409 con `{ motivo }` (fecha destino ocupada; SIN
 *     `colaDisponible`).
 *   - `CambiarFechaValidacionError` (`fecha`|`guarda`) → 422.
 *   - `ReservaNoEncontradaError` → 404.
 *   - Cualquier otro error (incl. `P2002` residual) se relanza al filtro global.
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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  CambiarFechaUseCase,
  CambiarFechaConflictoError,
  CambiarFechaValidacionError,
  ReservaNoEncontradaError,
} from '../application/cambiar-fecha.use-case';
import {
  ObtenerReservaUseCase,
  ReservaDetalleNoEncontradaError,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import { CambiarFechaRequestDto } from './cambiar-fecha.dto';
import { ReservaDetalleResponseDto } from './reserva-detalle.dto';

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
export class CambiarFechaController {
  constructor(
    private readonly cambiar: CambiarFechaUseCase,
    private readonly obtener: ObtenerReservaUseCase,
  ) {}

  @Post(':id/cambiar-fecha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar la fecha ya bloqueada de una RESERVA — operación atómica (US-051)',
    operationId: 'cambiarFechaReserva',
  })
  @ApiResponse({ status: 200, type: ReservaDetalleResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Autenticado sin rol Gestor.' })
  @ApiResponse({ status: 404, description: 'RESERVA inexistente / de otro tenant (RLS).' })
  @ApiResponse({ status: 409, description: 'Fecha destino ocupada por otra reserva.' })
  @ApiResponse({ status: 422, description: 'Guarda de origen o fecha no válidas.' })
  async cambiarFecha(
    @Param('id') id: string,
    @Body() dto: CambiarFechaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaDetalleResponseDto> {
    try {
      await this.cambiar.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        fechaEvento: new Date(dto.fechaEvento),
      });
      const detalle = await this.obtener.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return this.aResponse(detalle);
    } catch (error) {
      this.aHttp(error);
    }
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
      comentarios: r.comentarios,
      fechaCreacion: r.fechaCreacion.toISOString(),
      tieneBorradorE1Pendiente: r.tieneBorradorE1Pendiente,
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

  private aHttp(error: unknown): never {
    if (error instanceof CambiarFechaConflictoError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.motivo,
        motivo: error.motivo,
      });
    }
    if (
      error instanceof ReservaNoEncontradaError ||
      error instanceof ReservaDetalleNoEncontradaError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof CambiarFechaValidacionError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    throw error;
  }
}
