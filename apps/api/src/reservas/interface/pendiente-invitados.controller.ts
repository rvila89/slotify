/**
 * Controlador de la transición «pendiente de invitados»: `POST
 * /api/reservas/:id/pendiente-invitados` (US-007 / UC-06).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. Mapeo de errores de dominio:
 *   - `BloqueoNoVigenteError` → 409 con `{ motivo }` (esquema `BloqueoNoVigenteError`).
 *   - `TransicionPendienteInvitadosValidacionError` → 422 (guarda de origen).
 *   - `ReservaNoEncontradaError` → 404.
 *   - Cualquier otro error se relanza al filtro global.
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  TransicionPendienteInvitadosUseCase,
  BloqueoNoVigenteError,
  ReservaNoEncontradaError,
  TransicionPendienteInvitadosValidacionError,
  type TransicionPendienteInvitadosComando,
  type TransicionPendienteInvitadosResultado,
} from '../application/transicion-pendiente-invitados.use-case';
import {
  PendienteInvitadosRequestDto,
  PendienteInvitadosResponseDto,
} from './pendiente-invitados.dto';

// La protección JWT de este endpoint la aporta el `JwtAuthGuard` GLOBAL registrado
// como `APP_GUARD` en `app.module.ts` (igual que los controladores hermanos, p. ej.
// US-005): no se declara `@UseGuards`/`@Public` local para no romper esa
// consistencia. `@ApiBearerAuth` documenta el requisito de bearer en Swagger.
@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class PendienteInvitadosController {
  constructor(
    private readonly useCase: TransicionPendienteInvitadosUseCase,
  ) {}

  @Post(':id/pendiente-invitados')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Marcar consulta como pendiente de invitados — transición 2.b→2.c (UC-06 / US-007)',
  })
  async marcarPendienteInvitados(
    @Param('id') id: string,
    @Body() _dto: PendienteInvitadosRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<PendienteInvitadosResponseDto> {
    const comando: TransicionPendienteInvitadosComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
    };

    try {
      const resultado = await this.useCase.ejecutar(comando);
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aResponse(
    resultado: TransicionPendienteInvitadosResultado,
  ): PendienteInvitadosResponseDto {
    const { reserva } = resultado;
    return {
      reserva: {
        idReserva: reserva.idReserva,
        clienteId: reserva.clienteId,
        estado: reserva.estado,
        subEstado: reserva.subEstado,
        fechaEvento: reserva.fechaEvento
          ? reserva.fechaEvento.toISOString().slice(0, 10)
          : null,
        ttlExpiracion: reserva.ttlExpiracion
          ? reserva.ttlExpiracion.toISOString()
          : null,
      },
      consultasDescartadas: resultado.consultasDescartadas,
    };
  }

  private aHttp(error: unknown): never {
    if (error instanceof BloqueoNoVigenteError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.motivo,
        motivo: error.motivo,
      });
    }
    if (error instanceof ReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof TransicionPendienteInvitadosValidacionError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    throw error;
  }
}
