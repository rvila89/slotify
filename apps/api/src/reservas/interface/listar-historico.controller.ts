/**
 * Controlador de lectura del histórico: `GET /api/historico` →
 * `ReservaHistoricoListResponse` (histórico de reservas CERRADAS, US-042 / UC-32).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ query de aplicación. El `tenant_id`
 * SIEMPRE deriva del JWT (`@CurrentUser`), NUNCA del query/path/body; el guard de auth
 * (`JwtAuthGuard`) protege el endpoint (401 sin token). Los filtros de fecha (`YYYY-MM-DD`)
 * se parsean a `Date` (medianoche UTC) para el use-case. Lectura pura: sin mutaciones.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ListarHistoricoUseCase,
  type HistoricoListResponse,
  type ListarHistoricoComando,
} from '../application/listar-historico.use-case';
import {
  ListarHistoricoQueryDto,
  ReservaHistoricoListResponseDto,
} from './listar-historico.dto';

/** Parsea una fecha `YYYY-MM-DD` a `Date` en medianoche UTC (DATE sin hora); undefined si ausente. */
const parsearFechaUtc = (fecha?: string): Date | undefined =>
  fecha === undefined ? undefined : new Date(`${fecha}T00:00:00.000Z`);

@ApiTags('Historico')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('historico')
export class ListarHistoricoController {
  constructor(private readonly useCase: ListarHistoricoUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Buscar y filtrar en el histórico (UC-32 / US-042)',
  })
  @ApiOkResponse({ type: ReservaHistoricoListResponseDto })
  async listar(
    @Query() query: ListarHistoricoQueryDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaHistoricoListResponseDto> {
    const comando: ListarHistoricoComando = {
      // tenant SIEMPRE del JWT, jamás del query.
      tenantId: usuario.tenantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: query.q,
      estadoFinal: query.estadoFinal,
      fechaDesde: parsearFechaUtc(query.fechaDesde),
      fechaHasta: parsearFechaUtc(query.fechaHasta),
      tipoEvento: query.tipoEvento,
      importeMin: query.importeMin,
      importeMax: query.importeMax,
    };

    const resultado = await this.useCase.ejecutar(comando);
    return this.aResponse(resultado);
  }

  private aResponse(resultado: HistoricoListResponse): ReservaHistoricoListResponseDto {
    return {
      data: resultado.data.map((item) => ({
        idReserva: item.idReserva,
        codigo: item.codigo,
        clienteId: item.clienteId,
        clienteNombre: item.clienteNombre,
        clienteApellidos: item.clienteApellidos,
        estado: item.estado,
        fechaEvento: item.fechaEvento,
        tipoEvento: item.tipoEvento,
        importeTotal: item.importeTotal,
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
