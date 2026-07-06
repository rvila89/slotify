/**
 * Controlador de lectura del pipeline: `GET /api/reservas` → `ReservaListResponse`
 * (pipeline de reservas activas US-049 / UC-37 / UC-38).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ query de aplicación. El `tenant_id`
 * SIEMPRE deriva del JWT (`@CurrentUser`), NUNCA del query/path/body; el guard de auth
 * global (`JwtAuthGuard`) protege el endpoint (401 sin token). Los filtros de fecha
 * (`YYYY-MM-DD`) se parsean a `Date` (medianoche UTC) para el use-case. Lectura pura:
 * sin mutaciones.
 *
 * NOTA de ruteo: este `GET /reservas` (sin path param) coexiste con `GET /reservas/:id`
 * (`ObtenerReservaController`); NestJS enruta la raíz aquí y `/:id` allí sin colisión.
 */
import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ListarReservasUseCase,
  type ListarReservasComando,
  type ReservaListResponse,
} from '../application/listar-reservas.use-case';
import {
  ListarReservasQueryDto,
  ReservaListResponseDto,
} from './listar-reservas.dto';

/** Parsea una fecha `YYYY-MM-DD` a `Date` en medianoche UTC (DATE sin hora); undefined si ausente. */
const parsearFechaUtc = (fecha?: string): Date | undefined =>
  fecha === undefined ? undefined : new Date(`${fecha}T00:00:00.000Z`);

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class ListarReservasController {
  constructor(private readonly useCase: ListarReservasUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar reservas del pipeline (UC-37 / UC-38 / US-049)',
  })
  @ApiOkResponse({ type: ReservaListResponseDto })
  async listar(
    @Query() query: ListarReservasQueryDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaListResponseDto> {
    const comando: ListarReservasComando = {
      // tenant SIEMPRE del JWT, jamás del query.
      tenantId: usuario.tenantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      estado: query.estado,
      subEstado: query.subEstado,
      fechaDesde: parsearFechaUtc(query.fechaDesde),
      fechaHasta: parsearFechaUtc(query.fechaHasta),
      search: query.search,
    };

    const resultado = await this.useCase.ejecutar(comando);
    return this.aResponse(resultado);
  }

  private aResponse(resultado: ReservaListResponse): ReservaListResponseDto {
    return {
      data: resultado.data.map((item) => ({
        id: item.id,
        codigo: item.codigo,
        estado: item.estado,
        subEstado: item.subEstado,
        fechaCreacion: item.fechaCreacion,
        nombreEvento: item.nombreEvento,
        progressLogistica: item.progressLogistica,
        progressLiquidacion: item.progressLiquidacion,
      })),
      metadata: {
        total: resultado.metadata.total,
        page: resultado.metadata.page,
        limit: resultado.metadata.limit,
        totalPages: resultado.metadata.totalPages,
      },
    };
  }
}
