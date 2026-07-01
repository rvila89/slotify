/**
 * Controlador del calendario de disponibilidad: `GET /calendario`
 * (US-039 / UC-29). Traduce el contrato HTTP (congelado) ↔ comando de aplicación.
 *
 * El `tenant_id` SIEMPRE deriva del JWT (`@CurrentUser`), NUNCA del query/path (§D-4):
 * el query solo trae el rango y la vista. Parsea `desde`/`hasta` (date `YYYY-MM-DD`)
 * a `Date` (medianoche UTC) para el use-case y, a la vuelta, mapea el read-model a la
 * forma de `CalendarioResponse`/`CalendarioFecha`: rango/fecha a `date` (YYYY-MM-DD) y
 * `ttlExpiracion` a `date-time` ISO (o `null`). Lectura pura: sin mutaciones.
 */
import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ObtenerCalendarioUseCase,
  type CalendarioFechaLectura,
  type CalendarioLectura,
  type ObtenerCalendarioComando,
  type VistaCalendario,
} from '../application/obtener-calendario.query';
import {
  CalendarioFechaResponseDto,
  CalendarioResponseDto,
  ConsultarCalendarioQueryDto,
} from './consultar-calendario.dto';

/** Formatea un `Date` a `YYYY-MM-DD` (contrato `date`). */
const aFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Formatea un `Date` a ISO completo (contrato `date-time`); null si ausente. */
const aFechaHora = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString();

/** Parsea una fecha `YYYY-MM-DD` a `Date` en medianoche UTC (DATE sin hora). */
const parsearFechaUtc = (fecha: string): Date => new Date(`${fecha}T00:00:00.000Z`);

@ApiTags('Calendario')
@ApiBearerAuth()
@Controller('calendario')
export class ConsultarCalendarioController {
  constructor(private readonly useCase: ObtenerCalendarioUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar calendario de disponibilidad (UC-29 / US-039)',
  })
  @ApiOkResponse({ type: CalendarioResponseDto })
  async consultar(
    @Query() query: ConsultarCalendarioQueryDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<CalendarioResponseDto> {
    const comando: ObtenerCalendarioComando = {
      // tenant SIEMPRE del JWT, jamás del query (§D-4).
      tenantId: usuario.tenantId,
      desde: parsearFechaUtc(query.desde),
      hasta: parsearFechaUtc(query.hasta),
      vista: (query.vista ?? 'mes') as VistaCalendario,
    };

    const lectura = await this.useCase.ejecutar(comando);
    return this.aResponse(lectura);
  }

  private aResponse(lectura: CalendarioLectura): CalendarioResponseDto {
    return {
      rango: {
        desde: aFecha(lectura.rango.desde),
        hasta: aFecha(lectura.rango.hasta),
      },
      fechas: lectura.fechas.map((f) => this.aFechaResponse(f)),
    };
  }

  private aFechaResponse(
    f: CalendarioFechaLectura,
  ): CalendarioFechaResponseDto {
    return {
      fecha: aFecha(f.fecha),
      color: f.color,
      estado: f.estado,
      subEstado: f.subEstado,
      reservaId: f.reservaId,
      cliente: f.cliente,
      ttlExpiracion: aFechaHora(f.ttlExpiracion),
      enCola: f.enCola,
    };
  }
}
