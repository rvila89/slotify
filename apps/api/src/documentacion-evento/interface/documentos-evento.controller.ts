/**
 * Controlador de la DOCUMENTACIÓN obligatoria del evento (US-033 / UC-24):
 *   - `POST /reservas/{id}/documentos-evento` → 201 (multipart, `archivo` + `tipo`).
 *   - `GET  /reservas/{id}/documentos-evento/checklist` → 200.
 *
 * Traduce el contrato HTTP (congelado) ↔ comando/query de aplicación. El `tenant_id` y el
 * `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body. El fichero
 * llega por `multipart/form-data` (`FileInterceptor`, almacenamiento en memoria); si no se
 * adjunta, el VO es `null` (→ ARCHIVO_REQUERIDO). Mapeo de errores de dominio (mismo patrón
 * que `confirmar-pago-senal.controller.ts`):
 *   - 404: `ReservaNoEncontradaError`.
 *   - 422: `EstadoNoPermiteDocumentacionError`, `TipoDocumentoNoPermitidoError`,
 *          `ArchivoRequeridoError`, `FormatoNoPermitidoError`, `ArchivoInvalidoError`,
 *          `TamanoExcedidoError`.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  SubirDocumentoEventoUseCase,
  ArchivoInvalidoError,
  ArchivoRequeridoError,
  EstadoNoPermiteDocumentacionError,
  FormatoNoPermitidoError,
  ReservaNoEncontradaError,
  TamanoExcedidoError,
  TipoDocumentoNoPermitidoError,
  type ArchivoDocumentoEventoSubido,
  type SubirDocumentoEventoComando,
  type SubirDocumentoEventoResultado,
} from '../application/subir-documento-evento.use-case';
import {
  ObtenerChecklistDocumentacionEventoQuery,
  ReservaNoEncontradaError as ReservaNoEncontradaChecklistError,
  type ChecklistDocumentacionEvento,
} from '../application/obtener-checklist-documentacion-evento.query';

/** Fichero subido por multer (subconjunto de `Express.Multer.File`). */
interface FicheroSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('DocumentacionEvento')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class DocumentosEventoController {
  constructor(
    private readonly subirDocumento: SubirDocumentoEventoUseCase,
    private readonly checklistQuery: ObtenerChecklistDocumentacionEventoQuery,
  ) {}

  @Post(':id/documentos-evento')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Capturar un documento obligatorio del evento (UC-24 / US-033)',
  })
  @UseInterceptors(FileInterceptor('archivo'))
  async subir(
    @Param('id') id: string,
    @Body('tipo') tipo: string,
    @UploadedFile() fichero: FicheroSubido | undefined,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<SubirDocumentoEventoResultado> {
    const comando: SubirDocumentoEventoComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      tipo: tipo as SubirDocumentoEventoComando['tipo'],
      archivo: this.aArchivo(fichero),
    };
    try {
      return await this.subirDocumento.ejecutar(comando);
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Get(':id/documentos-evento/checklist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar el checklist de la documentación del evento (UC-24 / US-033)',
  })
  async obtenerChecklist(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ChecklistDocumentacionEvento> {
    try {
      return await this.checklistQuery.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Mapea el fichero multer al VO de dominio; `null` si no se adjuntó. */
  private aArchivo(
    fichero: FicheroSubido | undefined,
  ): ArchivoDocumentoEventoSubido | null {
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

  private aHttp(error: unknown): never {
    if (
      error instanceof ReservaNoEncontradaError ||
      error instanceof ReservaNoEncontradaChecklistError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof EstadoNoPermiteDocumentacionError ||
      error instanceof TipoDocumentoNoPermitidoError ||
      error instanceof ArchivoRequeridoError ||
      error instanceof FormatoNoPermitidoError ||
      error instanceof ArchivoInvalidoError ||
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
