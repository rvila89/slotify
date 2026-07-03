/**
 * Controlador de la confirmación del pago de la señal / activación de la reserva
 * confirmada (US-021 / UC-17):
 *   - `POST /reservas/{id}/confirmar-senal` → 200 (multipart, campo `justificante`).
 *
 * Traduce el contrato HTTP (congelado) ↔ comando de aplicación. El `tenant_id` y el
 * `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path/body. El fichero
 * llega por `multipart/form-data` (`FileInterceptor`, almacenamiento en memoria). Mapeo de
 * errores de dominio (F5-02):
 *   - 422: `OrigenInvalidoError`, `JustificanteRequeridoError`, `FormatoNoPermitidoError`,
 *          `TamanoExcedidoError`, `ImporteTotalInvalidoError`.
 *   - 409: `ReservaYaConfirmadaError`, `FechaNoDisponibleError`.
 *   - 404: `ReservaNoEncontradaError`.
 */
import {
  ConflictException,
  Controller,
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
  ConfirmarPagoSenalUseCase,
  FechaNoDisponibleError,
  FormatoNoPermitidoError,
  ImporteTotalInvalidoError,
  JustificanteRequeridoError,
  OrigenInvalidoError,
  ReservaNoEncontradaError,
  ReservaYaConfirmadaError,
  TamanoExcedidoError,
  type ConfirmarPagoSenalComando,
  type ConfirmarPagoSenalResultado,
  type JustificanteSubido,
} from '../application/confirmar-pago-senal.use-case';
import { ConfirmarSenalResponseDto } from './confirmar-pago-senal.dto';

/** Fichero subido por multer (subconjunto de `Express.Multer.File`). */
interface FicheroSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Confirmacion')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class ConfirmarPagoSenalController {
  constructor(private readonly useCase: ConfirmarPagoSenalUseCase) {}

  @Post(':id/confirmar-senal')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Confirmar pago de señal y activar reserva confirmada (UC-17 / US-021)',
  })
  @UseInterceptors(FileInterceptor('justificante'))
  async confirmarSenal(
    @Param('id') id: string,
    @UploadedFile() fichero: FicheroSubido | undefined,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ConfirmarSenalResponseDto> {
    const comando: ConfirmarPagoSenalComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      justificante: this.aJustificante(fichero),
    };
    try {
      return this.aResponse(await this.useCase.ejecutar(comando));
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Mapea el fichero multer al justificante de dominio; `null` si no se adjuntó. */
  private aJustificante(fichero: FicheroSubido | undefined): JustificanteSubido | null {
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

  private aResponse(
    resultado: ConfirmarPagoSenalResultado,
  ): ConfirmarSenalResponseDto {
    return {
      reserva: {
        idReserva: resultado.reservaId,
        estado: resultado.estado,
        ttlExpiracion: null,
        importeSenal: resultado.importeSenal,
        importeLiquidacion: resultado.importeLiquidacion,
        preEventoStatus: 'pendiente',
        liquidacionStatus: 'pendiente',
        fianzaStatus: 'pendiente',
      },
      justificante: {
        idDocumento: resultado.documento.idDocumento,
        tipo: resultado.documento.tipo,
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
    if (
      error instanceof ReservaYaConfirmadaError ||
      error instanceof FechaNoDisponibleError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (
      error instanceof OrigenInvalidoError ||
      error instanceof JustificanteRequeridoError ||
      error instanceof FormatoNoPermitidoError ||
      error instanceof TamanoExcedidoError ||
      error instanceof ImporteTotalInvalidoError
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
