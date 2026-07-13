/**
 * Controlador de la ACTUALIZACIÓN DE DATOS FISCALES DEL CLIENTE:
 * `PATCH /api/reservas/:id/datos-fiscales` (US-014 #5, Parte B / UC-14, actor Gestor).
 *
 * Traduce el contrato HTTP (op `actualizarDatosFiscalesCliente`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body
 * (D-3/D-4). El `{id}` de la ruta es la RESERVA sobre la que se contextualiza la acción; los campos
 * fiscales viajan en el body (PATCH parcial). Autorización: acción del GESTOR (JWT de usuario). El
 * `JwtAuthGuard` GLOBAL exige token (401 sin él); aquí se añade `RolesGuard` + `@Roles('gestor')`
 * para que un autenticado SIN rol Gestor reciba 403 sin ejecutar el caso de uso.
 *
 * Mapeo de errores de dominio a códigos (contrato):
 *   - `ReservaNoEncontradaError` → 404 (inexistente / otro tenant bajo RLS).
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ActualizarDatosFiscalesClienteUseCase,
  ReservaNoEncontradaError,
  type ActualizarDatosFiscalesClienteResultado,
  type DatosFiscalesClienteParcial,
} from '../application/actualizar-datos-fiscales-cliente.use-case';
import {
  ActualizarDatosFiscalesClienteRequestDto,
  ActualizarDatosFiscalesClienteResponseDto,
} from './actualizar-datos-fiscales-cliente.dto';

@ApiTags('Reservas')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class ActualizarDatosFiscalesClienteController {
  constructor(private readonly servicio: ActualizarDatosFiscalesClienteUseCase) {}

  @Patch(':id/datos-fiscales')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar datos fiscales del cliente de una reserva (UC-14 / US-014, #5)',
    operationId: 'actualizarDatosFiscalesCliente',
  })
  @ApiResponse({ status: 200, type: ActualizarDatosFiscalesClienteResponseDto })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido (vacío, campo vacío o propiedad ajena).' })
  @ApiResponse({ status: 401, description: 'No autenticado.' })
  @ApiResponse({ status: 403, description: 'Autenticado sin rol Gestor.' })
  @ApiResponse({ status: 404, description: 'RESERVA inexistente / de otro tenant (RLS).' })
  async actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarDatosFiscalesClienteRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ActualizarDatosFiscalesClienteResponseDto> {
    try {
      const resultado = await this.servicio.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        datos: this.extraerDatos(dto),
      });
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Recoge SOLO los campos fiscales presentes en el body (PATCH parcial, D-2). */
  private extraerDatos(
    dto: ActualizarDatosFiscalesClienteRequestDto,
  ): DatosFiscalesClienteParcial {
    const datos: DatosFiscalesClienteParcial = {};
    if (dto.dniNif !== undefined) datos.dniNif = dto.dniNif;
    if (dto.direccion !== undefined) datos.direccion = dto.direccion;
    if (dto.codigoPostal !== undefined) datos.codigoPostal = dto.codigoPostal;
    if (dto.poblacion !== undefined) datos.poblacion = dto.poblacion;
    if (dto.provincia !== undefined) datos.provincia = dto.provincia;
    return datos;
  }

  private aResponse(
    resultado: ActualizarDatosFiscalesClienteResultado,
  ): ActualizarDatosFiscalesClienteResponseDto {
    return {
      dniNif: resultado.dniNif,
      direccion: resultado.direccion,
      codigoPostal: resultado.codigoPostal,
      poblacion: resultado.poblacion,
      provincia: resultado.provincia,
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
    throw error;
  }
}
