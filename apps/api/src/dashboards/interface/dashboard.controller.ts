/**
 * Controlador del dashboard operativo: `GET /dashboard` (US-044 / UC-34). Traduce el
 * contrato HTTP (congelado) ↔ comando de aplicación. LECTURA PURA: sin mutaciones.
 *
 * El `tenant_id` SIEMPRE deriva del JWT (`@CurrentUser`), NUNCA del cliente (§D-4);
 * no hay query params (§D-1). A la vuelta, mapea el resultado del use-case a la forma
 * de `DashboardResponse`, añadiendo el `enlace` a la ficha de cada ítem (§FA-02).
 */
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import { ConsultarDashboardUseCase } from '../application/consultar-dashboard.use-case';
import type {
  DashboardItem,
  DashboardItemProximos30Dias,
  DashboardWidget,
} from '../application/consultar-dashboard.use-case';
import {
  DashboardItemDto,
  DashboardItemProximos30DiasDto,
  DashboardProximos30DiasWidgetDto,
  DashboardResponseDto,
  DashboardWidgetDto,
} from './dashboard.dto';

/** Construye el enlace a la ficha de detalle de una reserva (§FA-02). */
const enlaceFicha = (reservaId: string): string => `/reservas/${reservaId}`;

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly useCase: ConsultarDashboardUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Visualizar dashboard operativo (UC-34 / US-044)',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  async consultar(
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<DashboardResponseDto> {
    const resultado = await this.useCase.ejecutar({
      // tenant SIEMPRE del JWT, jamás del cliente (§D-4).
      tenantId: usuario.tenantId,
    });

    return {
      hoyManana: this.aWidget(resultado.hoyManana),
      pipeline: this.aWidget(resultado.pipeline),
      subProcesosCriticos: this.aWidget(resultado.subProcesosCriticos),
      pendientes: this.aWidget(resultado.pendientes),
      consultasEnCola: this.aWidget(resultado.consultasEnCola),
      visitasProgramadas: this.aWidget(resultado.visitasProgramadas),
      proximos30Dias: this.aWidgetProximos30Dias(resultado.proximos30Dias),
    };
  }

  private aWidget(widget: DashboardWidget): DashboardWidgetDto {
    return {
      items: widget.items.map((i) => this.aItem(i)),
      total: widget.total,
    };
  }

  private aWidgetProximos30Dias(
    widget: DashboardWidget<DashboardItemProximos30Dias>,
  ): DashboardProximos30DiasWidgetDto {
    return {
      items: widget.items.map((i) => this.aItemProximos30Dias(i)),
      total: widget.total,
    };
  }

  private aItem(item: DashboardItem): DashboardItemDto {
    return {
      reservaId: item.reservaId,
      codigo: item.codigo,
      clienteNombre: item.clienteNombre,
      estado: item.estado,
      subEstado: item.subEstado,
      fechaEvento: item.fechaEvento,
      enlace: enlaceFicha(item.reservaId),
    };
  }

  private aItemProximos30Dias(
    item: DashboardItemProximos30Dias,
  ): DashboardItemProximos30DiasDto {
    return {
      ...this.aItem(item),
      color: item.color,
    };
  }
}
