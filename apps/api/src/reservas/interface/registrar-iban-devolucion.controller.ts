/**
 * Controlador del REGISTRO DE IBAN DE DEVOLUCIÓN: `PATCH /api/reservas/:id/iban-devolucion`
 * (US-035 / UC-26 FA-01, UC-27, actor Gestor).
 *
 * Traduce el contrato HTTP (op `registrarIbanDevolucion`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body
 * (D-5A). El `{id}` de la ruta es la RESERVA en `post_evento` sobre la que se contextualiza la
 * acción; el `iban` viaja en el body. Autorización: acción del GESTOR (JWT de usuario, NO
 * `X-Cron-Token`). El `JwtAuthGuard` GLOBAL exige token (401 sin él); aquí se añade
 * `RolesGuard` + `@Roles('gestor')` para que un autenticado SIN rol Gestor reciba 403 sin
 * ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
 *   - `IbanInvalidoError` → 422 (checksum mod-97 fallido, FA-01).
 *   - `EstadoNoPostEventoError` / `SinFianzaError` → 409 con `code` semántico (FA-04).
 *   - Cualquier otro error se relanza al filtro global.
 */
import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  RegistrarIbanDevolucionUseCase,
  ReservaNoEncontradaError,
  IbanInvalidoError,
  EstadoNoPostEventoError,
  SinFianzaError,
  type RegistrarIbanDevolucionResultado,
} from '../application/registrar-iban-devolucion.use-case';
import {
  RegistrarIbanDevolucionRequestDto,
  RegistrarIbanDevolucionResponseDto,
} from './registrar-iban-devolucion.dto';

@ApiTags('Reservas')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class RegistrarIbanDevolucionController {
  constructor(private readonly servicio: RegistrarIbanDevolucionUseCase) {}

  @Patch(':id/iban-devolucion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Registrar IBAN de devolución de fianza y confirmar recepción (UC-26/UC-27 / US-035)',
    operationId: 'registrarIbanDevolucion',
  })
  @ApiResponse({ status: 200, type: RegistrarIbanDevolucionResponseDto })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido (iban ausente o formato incorrecto).' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Autenticado sin rol Gestor.' })
  @ApiResponse({ status: 404, description: 'RESERVA inexistente / de otro tenant (RLS).' })
  @ApiResponse({ status: 409, description: 'Conflicto de precondición (FA-04).' })
  @ApiResponse({ status: 422, description: 'IBAN inválido por checksum mod-97 (FA-01).' })
  async registrar(
    @Param('id') id: string,
    @Body() dto: RegistrarIbanDevolucionRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<RegistrarIbanDevolucionResponseDto> {
    try {
      const resultado = await this.servicio.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        iban: dto.iban,
      });
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aResponse(
    resultado: RegistrarIbanDevolucionResultado,
  ): RegistrarIbanDevolucionResponseDto {
    return {
      iban: resultado.iban,
      avisoEmail:
        resultado.avisoEmail === null
          ? null
          : {
              codigo: resultado.avisoEmail.codigo,
              mensaje: resultado.avisoEmail.mensaje,
              comunicacionId: resultado.avisoEmail.comunicacionId,
            },
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
    if (error instanceof IbanInvalidoError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        code: error.codigo,
      });
    }
    if (
      error instanceof EstadoNoPostEventoError ||
      error instanceof SinFianzaError
    ) {
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
