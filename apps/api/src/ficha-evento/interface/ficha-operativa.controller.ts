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
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  LeerFichaOperativaUseCase,
} from '../application/leer-ficha-operativa.use-case';
import {
  GuardarFichaOperativaUseCase,
  type CamposEstructuralesFicha,
  type GuardarFichaOperativaResultado,
} from '../application/guardar-ficha-operativa.use-case';
import {
  CerrarFichaOperativaUseCase,
  type CerrarFichaOperativaResultado,
} from '../application/cerrar-ficha-operativa.use-case';
import {
  FueraDeVentanaVivaError,
  PrecioManualRequeridoError,
  ImporteSenalInvalidoError,
  type RecalcularReservaVivaResultado,
} from '../application/recalcular-reserva-viva.use-case';
import type {
  CamposFichaOperativa,
  FichaOperativa,
} from '../domain/ficha-operativa.ports';
import {
  CerrarFichaOperativaResponseDto,
  FichaOperativaResponseDto,
  GuardarFichaOperativaRequestDto,
  GuardarFichaOperativaResponseDto,
  RecalculoResultadoDto,
} from './ficha-operativa.dto';

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

/** Duración estructurada como enum INTEGER del contrato (`{4,8,12}`), o null. */
const aDuracionHorasEnum = (
  horas: number | null | undefined,
): 4 | 8 | 12 | null => {
  if (horas === 4 || horas === 8 || horas === 12) {
    return horas;
  }
  return null;
};

/**
 * Proyecta el resultado del recálculo del dominio al `RecalculoResultado` del contrato, o
 * `null` cuando el guardado no disparó recálculo (no-op de aforo/duración). `versionLiquidacion`
 * se mapea a la versión de la modificación (presupuesto y liquidación se regeneran en lockstep).
 */
const aRecalculoResponse = (
  recalculo: RecalcularReservaVivaResultado | undefined,
): RecalculoResultadoDto | null => {
  if (recalculo === undefined || !recalculo.recalculado) {
    return null;
  }
  const versionModificacion = recalculo.presupuesto?.version ?? null;
  return {
    tarifaAConsultar: recalculo.tarifaAConsultar,
    nuevoTotal: recalculo.nuevoTotal,
    pagoInicial: recalculo.pagoInicial,
    liquidacionRestante: recalculo.liquidacionRestante,
    versionPresupuesto: versionModificacion,
    versionLiquidacion: versionModificacion,
  };
};

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
  duracionHoras: aDuracionHorasEnum(ficha.duracionHoras),
  numAdultosNinosMayores4: ficha.numAdultosNinosMayores4 ?? null,
  numNinosMenores4: ficha.numNinosMenores4 ?? null,
  notasOperativas: ficha.notasOperativas,
  briefingEquipo: ficha.briefingEquipo,
  fichaCerrada: ficha.fichaCerrada,
  fechaCierre: aFechaHora(ficha.fechaCierre),
  preEventoStatus: ficha.preEventoStatus,
});

/** Proyecta el resultado del guardado (ficha + recálculo) al `GuardarFichaOperativaResponse`. */
const aGuardadoResponse = (
  resultado: GuardarFichaOperativaResultado,
): GuardarFichaOperativaResponseDto => ({
  ...aFichaResponse(resultado.ficha),
  recalculo: aRecalculoResponse(resultado.recalculo),
});

/** Extrae el subconjunto ESTRUCTURADO (aforo/duración) del body de guardado (§D-1). */
const extraerEstructurales = (
  cuerpo: GuardarFichaOperativaRequestDto,
): CamposEstructuralesFicha | undefined => {
  const estructurales: CamposEstructuralesFicha = {};
  if (cuerpo.duracionHoras !== undefined) {
    estructurales.duracionHoras = Number(cuerpo.duracionHoras);
  }
  if (cuerpo.numAdultosNinosMayores4 !== undefined) {
    estructurales.numAdultosNinosMayores4 = cuerpo.numAdultosNinosMayores4;
  }
  if (cuerpo.numNinosMenores4 !== undefined) {
    estructurales.numNinosMenores4 = cuerpo.numNinosMenores4;
  }
  if (cuerpo.precioManualEur !== undefined) {
    estructurales.precioManualEur = cuerpo.precioManualEur;
  }
  return Object.keys(estructurales).length > 0 ? estructurales : undefined;
};

/**
 * Extrae SOLO los campos OPERATIVOS (no estructurales) para el guardado de la ficha: los
 * estructurados (`duracionHoras`/desglose/`precioManualEur`) se enrutan a la RESERVA aparte.
 */
const extraerCamposOperativos = (
  cuerpo: GuardarFichaOperativaRequestDto,
): CamposFichaOperativa => {
  const {
    duracionHoras: _d,
    numAdultosNinosMayores4: _a,
    numNinosMenores4: _n,
    precioManualEur: _p,
    ...operativos
  } = cuerpo;
  return operativos;
};

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
  ): Promise<GuardarFichaOperativaResponseDto> {
    try {
      const resultado = await this.guardar.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        campos: extraerCamposOperativos(cuerpo),
        estructurales: extraerEstructurales(cuerpo),
      });
      return aGuardadoResponse(resultado);
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
    // change `reserva-viva-edicion-recalculo-ficha`: errores del recálculo → 422 (con `code`).
    if (
      error instanceof FueraDeVentanaVivaError ||
      error instanceof PrecioManualRequeridoError ||
      error instanceof ImporteSenalInvalidoError
    ) {
      return new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        code: error.codigo,
      });
    }
    return error;
  }
}
