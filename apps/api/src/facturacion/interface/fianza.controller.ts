/**
 * Controlador HTTP de la fianza pasiva (fix-liquidacion-fianza-independientes):
 *   - POST /reservas/{id}/fianza/comprobante → 200 (multipart, campo `comprobanteFianza`)
 *   - POST /reservas/{id}/fianza/devolver     → 200 (cuerpo vacío)
 *
 * El `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body.
 * Tras cada acción LEE el detalle de la RESERVA para devolverla completa (read-DTO
 * `ReservaDetalleResponseDto`).
 */
import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  SubirComprobanteFianzaUseCase,
  ComprobanteRequeridoError,
  EstadoInvalidoError,
  FormatoNoPermitidoError,
  ReservaNoEncontradaError,
  TamanoExcedidoError,
  type ComprobanteFianzaSubido,
} from '../application/subir-comprobante-fianza.use-case';
import {
  DevolverFianzaUseCase,
  DevolucionYaRegistradaError,
  PrecondicionNoCumplidaError,
  ReservaDevolverFianzaNoEncontradaError,
} from '../application/devolver-fianza.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../../reservas/application/obtener-reserva.query';
import {
  DevolverFianzaRequestDto,
  DevolverFianzaResponseDto,
  SubirComprobanteFianzaResponseDto,
} from './factura.dto';
import type { ReservaDetalleResponseDto } from '../../reservas/interface/reserva-detalle.dto';

/** Fichero subido por multer (subconjunto de `Express.Multer.File`). */
interface FicheroSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`); null si ausente. */
const aFecha = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

@ApiTags('Facturacion')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class FianzaController {
  constructor(
    private readonly subirComprobante: SubirComprobanteFianzaUseCase,
    private readonly devolverFianza: DevolverFianzaUseCase,
    @Inject(ObtenerReservaUseCase)
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Post(':id/fianza/comprobante')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el comprobante de la transferencia de fianza recibida (UC-22)' })
  @UseInterceptors(FileInterceptor('comprobanteFianza'))
  async subir(
    @Param('id') id: string,
    @UploadedFile() fichero: FicheroSubido | undefined,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<SubirComprobanteFianzaResponseDto> {
    try {
      const resultado = await this.subirComprobante.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        comprobante: this.aComprobante(fichero),
      });
      const detalle = await this.obtenerReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return {
        reserva: this.aReservaResponse(detalle),
        comprobante: {
          idDocumento: resultado.documento.idDocumento,
          reservaId: resultado.documento.reservaId ?? null,
          tipo: resultado.documento.tipo,
          url: resultado.documento.url,
          mimeType: resultado.documento.mimeType,
        },
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/fianza/devolver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar la devolución completa de la fianza + email E10 (UC-27)' })
  async devolver(
    @Param('id') id: string,
    @Body() _body: DevolverFianzaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<DevolverFianzaResponseDto> {
    try {
      const resultado = await this.devolverFianza.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      const detalle = await this.obtenerReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return {
        reserva: this.aReservaResponse(detalle),
        avisoEmail:
          resultado.avisoEmail === null
            ? null
            : {
                codigo: resultado.avisoEmail.codigo,
                mensaje: resultado.avisoEmail.mensaje,
                comunicacionId: resultado.avisoEmail.comunicacionId,
              },
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Mapea el fichero multer al comprobante de dominio; `null` si no se adjuntó. */
  private aComprobante(fichero: FicheroSubido | undefined): ComprobanteFianzaSubido | null {
    if (fichero === undefined || fichero === null) {
      return null;
    }
    return {
      nombreArchivo: fichero.originalname,
      mimeType: fichero.mimetype,
      tamanoBytes: fichero.size,
      buffer: fichero.buffer,
    };
  }

  private aReservaResponse(r: ReservaDetalleLectura): ReservaDetalleResponseDto {
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

  private aHttp(error: unknown): never {
    if (
      error instanceof ReservaNoEncontradaError ||
      error instanceof ReservaDevolverFianzaNoEncontradaError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof EstadoInvalidoError ||
      error instanceof ComprobanteRequeridoError ||
      error instanceof FormatoNoPermitidoError ||
      error instanceof TamanoExcedidoError
    ) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof PrecondicionNoCumplidaError ||
      error instanceof DevolucionYaRegistradaError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    throw error;
  }
}
