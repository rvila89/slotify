/**
 * Controlador del registro de la firma de las condiciones particulares (US-024 / UC-19
 * segundo flujo):
 *   - `POST /reservas/{id}/condiciones-firmadas` → 200 (multipart, campo
 *     `condicionesFirmadas`).
 *
 * Traduce el contrato HTTP (congelado) ↔ comando de aplicación. El `tenant_id` y el
 * `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body. El fichero
 * llega por `multipart/form-data` (`FileInterceptor`, almacenamiento en memoria). Tras el
 * registro, LEE el detalle de la RESERVA para devolverla completa (read-DTO
 * `ReservaDetalleResponseDto`; la fecha de firma viaja como `condPartFechaFirma`). Mapeo
 * de errores de dominio (espejo de `confirmar-senal`):
 *   - 409: `CondicionesNoEnviadasError`.
 *   - 422: `EstadoInvalidoError`, `CondicionesRequeridasError`, `FormatoNoPermitidoError`,
 *          `TamanoExcedidoError`.
 *   - 404: `ReservaNoEncontradaError`.
 */
import {
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
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  CondicionesNoEnviadasError,
  CondicionesRequeridasError,
  EstadoInvalidoError,
  FormatoNoPermitidoError,
  RegistrarFirmaCondicionesUseCase,
  ReservaNoEncontradaError,
  TamanoExcedidoError,
  type CondicionesFirmadasSubidas,
  type RegistrarFirmaCondicionesComando,
} from '../application/registrar-firma-condiciones.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../../reservas/application/obtener-reserva.query';
import {
  DocumentoFirmadoDto,
  RegistrarCondicionesFirmadasResponseDto,
} from './registrar-firma-condiciones.dto';
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

@ApiTags('Confirmacion')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class RegistrarFirmaCondicionesController {
  constructor(
    private readonly useCase: RegistrarFirmaCondicionesUseCase,
    @Inject(ObtenerReservaUseCase)
    private readonly obtenerReserva: ObtenerReservaUseCase,
  ) {}

  @Post(':id/condiciones-firmadas')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Registrar la firma de las condiciones particulares (UC-19 / US-024)',
  })
  @UseInterceptors(FileInterceptor('condicionesFirmadas'))
  async registrarFirma(
    @Param('id') id: string,
    @UploadedFile() fichero: FicheroSubido | undefined,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<RegistrarCondicionesFirmadasResponseDto> {
    const comando: RegistrarFirmaCondicionesComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      condiciones: this.aCondiciones(fichero),
    };
    try {
      const resultado = await this.useCase.ejecutar(comando);
      const detalle = await this.obtenerReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return {
        reserva: this.aReservaResponse(detalle),
        documentoFirmado: this.aDocumentoFirmado(resultado.documento),
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Mapea el fichero multer a las condiciones de dominio; `null` si no se adjuntó. */
  private aCondiciones(
    fichero: FicheroSubido | undefined,
  ): CondicionesFirmadasSubidas | null {
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

  private aDocumentoFirmado(documento: {
    idDocumento: string;
    tipo: string;
    reservaId?: string;
    url: string;
    mimeType: string;
  }): DocumentoFirmadoDto {
    return {
      idDocumento: documento.idDocumento,
      reservaId: documento.reservaId ?? null,
      tipo: documento.tipo,
      url: documento.url,
      mimeType: documento.mimeType,
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
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (error instanceof CondicionesNoEnviadasError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof EstadoInvalidoError ||
      error instanceof CondicionesRequeridasError ||
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
    throw error;
  }
}
