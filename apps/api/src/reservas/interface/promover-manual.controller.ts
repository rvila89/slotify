/**
 * Controlador de la PROMOCIÓN MANUAL de cola: `POST /api/reservas/:id/promover`
 * (US-019 / UC-12 FA manual, actor Gestor).
 *
 * Traduce el contrato HTTP (op `promoverConsultaCola`) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del
 * path/body (D-7). El `{id}` de la ruta es la RESERVA en `2.d` que el Gestor promueve.
 * Autorización: la promoción manual es una acción del GESTOR. El `JwtAuthGuard` GLOBAL
 * (APP_GUARD) exige token (401 sin él); aquí se añade el `RolesGuard` + `@Roles('gestor')`
 * (Fix 2, code-review US-019) para que un autenticado SIN rol Gestor reciba 403 sin
 * ejecutar el caso de uso, y el Gestor válido siga a 200.
 * Mapeo de errores de dominio a códigos (F5-02 + contrato):
 *   - `PromocionManualConfirmacionError` → 422 (confirmación ausente/false, D-1).
 *   - `PromocionManualConsultaNoEnColaError` → 422 (FA-05, "ya no está en cola").
 *   - `PromocionManualReservaNoEncontradaError` → 404 (reserva inexistente / otro tenant
 *     bajo RLS, H-1 code-review US-019).
 *   - `PromocionManualCarreraPerdidaError` → 409 (carrera perdida, D-4, mensaje recarga).
 *   - `PromocionManualSinBloqueoError` → 409 (inconsistencia: sin FECHA_BLOQUEADA activa).
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
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  PromocionManualCarreraPerdidaError,
  PromocionManualConfirmacionError,
  PromocionManualConsultaNoEnColaError,
  PromocionManualReservaNoEncontradaError,
  PromocionManualSinBloqueoError,
  PromoverManualEnColaService,
  type PromoverManualComando,
  type ResultadoPromocionManual,
} from '../application/promover-manual-en-cola.service';
import { PromoverManualRequestDto } from './promover-manual.dto';

@ApiTags('Cola')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class PromoverManualController {
  constructor(private readonly servicio: PromoverManualEnColaService) {}

  @Post(':id/promover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Promover una consulta de la cola a bloqueante — manual del Gestor (UC-12 / US-019)',
  })
  async promover(
    @Param('id') id: string,
    @Body() dto: PromoverManualRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ResultadoPromocionManual> {
    // Guarda de CONFIRMACIÓN explícita (defensa en servidor, D-1): sin `confirmado: true`
    // se rechaza en la frontera HTTP con 422, sin llegar al caso de uso ni a la BD.
    const confirmado = dto?.confirmado === true;

    const comando: PromoverManualComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      reservaId: id,
      confirmado,
    };

    try {
      if (!confirmado) {
        throw new PromocionManualConfirmacionError();
      }
      return await this.servicio.ejecutar(comando);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aHttp(error: unknown): never {
    // Reserva no resoluble bajo RLS (inexistente / otro tenant) → 404 (H-1). Se comprueba
    // ANTES del 422 de FA-05: ambos errores son DISTINTOS (no hay jerarquía compartida),
    // así que los códigos nunca colapsan.
    if (error instanceof PromocionManualReservaNoEncontradaError) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (
      error instanceof PromocionManualConfirmacionError ||
      error instanceof PromocionManualConsultaNoEnColaError
    ) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    if (
      error instanceof PromocionManualCarreraPerdidaError ||
      error instanceof PromocionManualSinBloqueoError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
      });
    }
    throw error;
  }
}
