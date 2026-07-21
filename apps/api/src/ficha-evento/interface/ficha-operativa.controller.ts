/**
 * Controlador HTTP de la FICHA_OPERATIVA (US-025 / UC-20). Endpoints anidados en la
 * reserva (contrato congelado):
 *   - `GET   /reservas/:id/ficha-operativa`         → leer (sin mutar).
 *   - `PATCH /reservas/:id/ficha-operativa`         → guardar parcial (+ disparo D-2 / edición D-4).
 *   - `POST  /reservas/:id/ficha-operativa/cerrar`  → cerrar (D-6, con avisosCamposVacios).
 *
 * El `tenant_id` SIEMPRE deriva del JWT (`@CurrentUser`), nunca del path/body; el guard
 * de auth global protege el endpoint (401 sin token). Mapeo de errores de dominio:
 *   - `FichaNoDisponibleError`   → 409 `{ code: 'ficha_no_disponible' }` (§D-3).
 *   - `ReservaNoEncontradaError` → 404 (cross-tenant invisible por RLS).
 */
import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  LeerFichaOperativaUseCase,
} from '../application/leer-ficha-operativa.use-case';
import { GuardarFichaOperativaUseCase } from '../application/guardar-ficha-operativa.use-case';
import {
  CerrarFichaOperativaUseCase,
  type CerrarFichaOperativaResultado,
} from '../application/cerrar-ficha-operativa.use-case';
import type { FichaOperativa } from '../domain/ficha-operativa.ports';
import {
  CerrarFichaOperativaResponseDto,
  FichaOperativaResponseDto,
  GuardarFichaOperativaRequestDto,
} from './ficha-operativa.dto';

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

/** Proyecta la ficha de dominio al DTO HTTP de respuesta. */
const aFichaResponse = (ficha: FichaOperativa): FichaOperativaResponseDto => ({
  idFicha: ficha.idFicha,
  reservaId: ficha.reservaId,
  numInvitadosConfirmado: ficha.numInvitadosConfirmado,
  contactoEventoNombre: ficha.contactoEventoNombre,
  contactoEventoTelefono: ficha.contactoEventoTelefono,
  contactoEventoCorreo: ficha.contactoEventoCorreo,
  horaLlegada: ficha.horaLlegada,
  duracion: ficha.duracion,
  notasOperativas: ficha.notasOperativas,
  briefingEquipo: ficha.briefingEquipo,
  fichaCerrada: ficha.fichaCerrada,
  fechaCierre: aFechaHora(ficha.fechaCierre),
  preEventoStatus: ficha.preEventoStatus,
});

@ApiTags('FichaOperativa')
@ApiBearerAuth()
@Controller('reservas/:id/ficha-operativa')
export class FichaOperativaController {
  constructor(
    private readonly leer: LeerFichaOperativaUseCase,
    private readonly guardar: GuardarFichaOperativaUseCase,
    private readonly cerrar: CerrarFichaOperativaUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar ficha operativa del evento (UC-20 / US-025)' })
  async leerFicha(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FichaOperativaResponseDto> {
    try {
      const ficha = await this.leer.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      return aFichaResponse(ficha);
    } catch (error) {
      throw this.traducirError(error);
    }
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar parcialmente la ficha operativa (UC-20 / US-025)' })
  async guardarFicha(
    @Param('id') id: string,
    @Body() cuerpo: GuardarFichaOperativaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FichaOperativaResponseDto> {
    try {
      const ficha = await this.guardar.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        campos: cuerpo,
      });
      return aFichaResponse(ficha);
    } catch (error) {
      throw this.traducirError(error);
    }
  }

  @Post('cerrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar la ficha operativa (UC-20 / US-025)' })
  async cerrarFicha(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<CerrarFichaOperativaResponseDto> {
    try {
      const resultado = await this.cerrar.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      return this.aCierreResponse(resultado);
    } catch (error) {
      throw this.traducirError(error);
    }
  }

  private aCierreResponse(
    resultado: CerrarFichaOperativaResultado,
  ): CerrarFichaOperativaResponseDto {
    return {
      ...aFichaResponse(resultado),
      avisosCamposVacios: resultado.avisosCamposVacios,
    };
  }

  /** Traduce los errores de dominio a excepciones HTTP del contrato congelado. */
  private traducirError(error: unknown): unknown {
    if (error instanceof FichaNoDisponibleError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        code: error.code,
      });
    }
    if (error instanceof ReservaNoEncontradaError) {
      return new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    return error;
  }
}
