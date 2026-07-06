/**
 * DTOs HTTP del dashboard operativo: `GET /dashboard` (US-044 / UC-34). Nombres
 * camelCase ALINEADOS con el contrato OpenAPI congelado (`DashboardResponse`,
 * `DashboardWidget`, `DashboardProximos30DiasWidget`, `DashboardItem`,
 * `DashboardItemProximos30Dias`).
 *
 * El `tenant_id` NO viaja en la petición: deriva SIEMPRE del JWT (`@CurrentUser`) en el
 * controlador. Sin query params (§D-1). Cada widget expone `items` + `total`; los ítems
 * de `proximos30Dias` añaden el `color` canónico del Calendario (US-039 / §D-2).
 */
import { ApiProperty } from '@nestjs/swagger';
import type { ColorCalendario } from '../../calendario/domain/derivacion-color';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

/** Ítem genérico de un widget — `DashboardItem`. */
export class DashboardItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ type: String, example: 'SLO-2026-0044' })
  codigo!: string;

  @ApiProperty({ type: String, example: 'Ana García' })
  clienteNombre!: string;

  @ApiProperty({ type: String, example: 'reserva_confirmada' })
  estado!: EstadoReserva;

  @ApiProperty({ type: String, nullable: true, example: '2b' })
  subEstado!: SubEstadoConsulta | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-07-08' })
  fechaEvento!: string | null;

  @ApiProperty({
    type: String,
    format: 'uri',
    description: 'Enlace directo a la ficha de detalle de la RESERVA (§FA-02).',
    example: '/reservas/11111111-1111-1111-1111-111111111111',
  })
  enlace!: string;
}

/** Ítem del widget "Próximos 30 días" — `DashboardItemProximos30Dias`. */
export class DashboardItemProximos30DiasDto extends DashboardItemDto {
  @ApiProperty({ enum: ['gris', 'ambar', 'verde', 'azul', 'rojo'], example: 'verde' })
  color!: ColorCalendario;
}

/** Widget genérico — `DashboardWidget`. */
export class DashboardWidgetDto {
  @ApiProperty({ type: [DashboardItemDto] })
  items!: DashboardItemDto[];

  @ApiProperty({ type: Number, minimum: 0, example: 3 })
  total!: number;
}

/** Widget "Próximos 30 días" — `DashboardProximos30DiasWidget`. */
export class DashboardProximos30DiasWidgetDto {
  @ApiProperty({ type: [DashboardItemProximos30DiasDto] })
  items!: DashboardItemProximos30DiasDto[];

  @ApiProperty({ type: Number, minimum: 0, example: 5 })
  total!: number;
}

/** Respuesta agregada del dashboard — `DashboardResponse`. */
export class DashboardResponseDto {
  @ApiProperty({ type: DashboardWidgetDto })
  hoyManana!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardWidgetDto })
  pipeline!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardWidgetDto })
  subProcesosCriticos!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardWidgetDto })
  pendientes!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardWidgetDto })
  consultasEnCola!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardWidgetDto })
  visitasProgramadas!: DashboardWidgetDto;

  @ApiProperty({ type: DashboardProximos30DiasWidgetDto })
  proximos30Dias!: DashboardProximos30DiasWidgetDto;
}
