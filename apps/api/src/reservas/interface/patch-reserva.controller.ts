/**
 * Controlador del UPDATE PARCIAL de campos simples de la RESERVA:
 * `PATCH /api/reservas/:id` (US-051 §Punto 2 / UC-14, actor Gestor).
 *
 * Traduce el contrato HTTP (op `UpdateReservaRequest` → `Reserva`) ↔ comando de
 * aplicación. El `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`),
 * NUNCA del path/body. El `{id}` de la ruta es la RESERVA; los campos simples viajan en el
 * body (PATCH parcial). `fechaEvento` NO se acepta por esta vía (regla dura §D-1): el DTO
 * no la incluye, así que un cliente que la envíe recibe 400 (`forbidNonWhitelisted`).
 *
 * Tras el commit, RE-LEE la RESERVA (bajo RLS) reusando `GET /reservas/{id}` para devolver
 * el `Reserva` completo actualizado.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ActualizarReservaValidacionError` → 400 (duración/horario/regla cruzada inválidos).
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ActualizarReservaUseCase,
  ActualizarReservaValidacionError,
  ReservaNoEncontradaError,
  type CamposReservaParcial,
} from '../application/actualizar-reserva.use-case';
import {
  ObtenerReservaUseCase,
  ReservaDetalleNoEncontradaError,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import { ActualizarReservaRequestDto } from './actualizar-reserva.dto';
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
export class PatchReservaController {
  constructor(
    private readonly actualizar: ActualizarReservaUseCase,
    private readonly obtener: ObtenerReservaUseCase,
  ) {}

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Actualizar datos simples de la reserva (US-051 §Punto 2 / UC-14)',
    operationId: 'actualizarReserva',
  })
  @ApiResponse({ status: 200, type: ReservaDetalleResponseDto })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido (duración/horario/campo ajeno).' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Autenticado sin rol Gestor.' })
  @ApiResponse({ status: 404, description: 'RESERVA inexistente / de otro tenant (RLS).' })
  async actualizarReserva(
    @Param('id') id: string,
    @Body() dto: ActualizarReservaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaDetalleResponseDto> {
    try {
      await this.actualizar.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        campos: this.extraerCampos(dto),
      });
      // Relectura POST-COMMIT reusando GET /reservas/{id} para devolver el `Reserva` completo.
      const detalle = await this.obtener.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return this.aResponse(detalle);
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Recoge SOLO los campos simples presentes en el body (PATCH parcial, §D-1). */
  private extraerCampos(dto: ActualizarReservaRequestDto): CamposReservaParcial {
    const campos: CamposReservaParcial = {};
    if (dto.tipoEvento !== undefined) campos.tipoEvento = dto.tipoEvento;
    if (dto.duracionHoras !== undefined) campos.duracionHoras = dto.duracionHoras;
    if (dto.numAdultosNinosMayores4 !== undefined) {
      campos.numAdultosNinosMayores4 = dto.numAdultosNinosMayores4;
    }
    if (dto.numNinosMenores4 !== undefined) campos.numNinosMenores4 = dto.numNinosMenores4;
    if (dto.numInvitadosFinal !== undefined) campos.numInvitadosFinal = dto.numInvitadosFinal;
    if (dto.notas !== undefined) campos.notas = dto.notas;
    if (dto.horario !== undefined) campos.horario = dto.horario;
    return campos;
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
    if (error instanceof ActualizarReservaValidacionError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.message,
        campo: error.campo,
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
    throw error;
  }
}
