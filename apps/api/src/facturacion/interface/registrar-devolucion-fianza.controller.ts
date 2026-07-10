/**
 * Controlador del REGISTRO DE LA DEVOLUCIÓN DE LA FIANZA: `POST /api/reservas/:id/fianza/devolucion`
 * (US-036 / UC-27 pasos 4-8, actor Gestor). Simétrico al cobro de US-030.
 *
 * Traduce el contrato HTTP (op `registrarDevolucionFianza`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body
 * (D-5). El `{id}` de la ruta es la RESERVA en `post_evento`; los campos de negocio viajan en el
 * body. Autorización: acción del GESTOR (`RolesGuard` + `@Roles('gestor')`): 401 sin JWT, 403
 * autenticado sin rol.
 *
 * Mapeo de errores de dominio a códigos (contrato `DevolucionFianzaError`, envelope + `codigo`):
 *   - `ImporteSuperaFianzaError` / `FechaDevolucionInvalidaError` / `MotivoRetencionRequeridoError`
 *     → 400 (FA-02 / FA-03 / parcial sin motivo).
 *   - `ReservaDevolucionNoEncontradaError` / `JustificanteNoEncontradoError` → 404 (RLS).
 *   - `PrecondicionNoCumplidaError` / `DevolucionYaRegistradaError` → 409.
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  RegistrarDevolucionFianzaUseCase,
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
  PrecondicionNoCumplidaError,
  DevolucionYaRegistradaError,
  ReservaDevolucionNoEncontradaError,
  JustificanteNoEncontradoError,
  type RegistrarDevolucionFianzaResultado,
} from '../application/registrar-devolucion-fianza.use-case';
import {
  RegistrarDevolucionFianzaRequestDto,
  RegistrarDevolucionFianzaResponseDto,
} from './registrar-devolucion-fianza.dto';

@ApiTags('Facturacion')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class RegistrarDevolucionFianzaController {
  constructor(private readonly servicio: RegistrarDevolucionFianzaUseCase) {}

  @Post(':id/fianza/devolucion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar la devolución de la fianza (UC-27 pasos 4-8 / US-036)',
    operationId: 'registrarDevolucionFianza',
  })
  @ApiResponse({ status: 200, type: RegistrarDevolucionFianzaResponseDto })
  @ApiResponse({ status: 400, description: 'Validación de entrada / dominio (FA-02/FA-03/motivo).' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Autenticado sin rol Gestor.' })
  @ApiResponse({ status: 404, description: 'RESERVA / justificante inexistente (RLS).' })
  @ApiResponse({ status: 409, description: 'Precondición incumplida / devolución ya registrada.' })
  async registrar(
    @Param('id') id: string,
    @Body() dto: RegistrarDevolucionFianzaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<RegistrarDevolucionFianzaResponseDto> {
    try {
      const resultado = await this.servicio.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        importeDevuelto: dto.importeDevuelto,
        fechaCobro: dto.fechaCobro,
        motivoRetencion: dto.motivoRetencion ?? null,
        justificanteDocId: dto.justificanteDocId ?? null,
      });
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aResponse(
    resultado: RegistrarDevolucionFianzaResultado,
  ): RegistrarDevolucionFianzaResponseDto {
    return {
      reserva: {
        idReserva: resultado.reserva.idReserva,
        fianzaStatus: resultado.reserva.fianzaStatus,
        fianzaDevueltaEur: resultado.reserva.fianzaDevueltaEur,
        fianzaDevueltaFecha: resultado.reserva.fianzaDevueltaFecha,
        motivoRetencion: resultado.reserva.motivoRetencion,
      },
      documentoJustificante: resultado.documentoJustificante ?? null,
      avisoSinJustificante: resultado.avisoSinJustificante,
    };
  }

  private aHttp(error: unknown): never {
    if (
      error instanceof ImporteSuperaFianzaError ||
      error instanceof FechaDevolucionInvalidaError ||
      error instanceof MotivoRetencionRequeridoError
    ) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof ReservaDevolucionNoEncontradaError ||
      error instanceof JustificanteNoEncontradoError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
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
      });
    }
    throw error;
  }
}
