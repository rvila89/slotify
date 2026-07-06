/**
 * Tipos de DOMINIO del Dashboard Operativo (US-044 / UC-34, `GET /dashboard`).
 * LECTURA PURA (design.md §D-1/§D-5): describen el dataset agregado que el puerto de
 * lectura entrega al use-case y los ítems que cada widget expone. Hexagonal (hook
 * `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma ni infraestructura;
 * solo tipos de dominio propios y del núcleo de reservas.
 */
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';
import type { ColorCalendario } from '../../calendario/domain/derivacion-color';

/**
 * Proyección de UNA reserva del dataset agregado del dashboard (read-model). El
 * adaptador Prisma real ya filtra por `tenant_id` + `activo = true`; el use-case aplica
 * las ventanas temporales y los criterios de cada widget sobre esta forma.
 */
export interface DashboardReservaLectura {
  /** ID de la reserva (enlace a la ficha). */
  reservaId: string;
  /** Tenant de la reserva (defensa en profundidad; el use-case no cruza tenants). */
  tenantId: string;
  /** Código legible de la reserva. */
  codigo: string;
  /** Nombre del cliente asociado. */
  clienteNombre: string;
  /** Estado de la reserva. */
  estado: EstadoReserva;
  /** Sub-estado de consulta; `null` fuera de la fase de consulta. */
  subEstado: SubEstadoConsulta | null;
  /** Fecha del evento (DATE `YYYY-MM-DD`); `null` si aún no fijada. */
  fechaEvento: string | null;
  /** Solo reservas activas participan en el dashboard (§FA-04). */
  activo: boolean;
  /** Estado del sub-proceso pre-evento (`cerrado` cuando la ficha está completa). */
  preEventoStatus: string | null;
  /** Estado del cobro de la liquidación (`cobrada` cuando saldada). */
  liquidacionStatus: string | null;
  /** Estado de la fianza (`cobrada` cuando cobrada). */
  fianzaStatus: string | null;
  /** Fecha programada de visita (sub-estado 2v); `null` si no aplica. */
  visitaProgramadaFecha: string | null;
  /** Posición en cola (sub-estado 2d); `null` si no aplica. */
  posicionCola: number | null;
  /** Instante de creación de la reserva. */
  fechaCreacion: Date;
}

/** Dataset agregado que el puerto de lectura entrega al use-case (todas las reservas del tenant). */
export interface DashboardDataset {
  reservas: DashboardReservaLectura[];
}

/** Ítem genérico de un widget del dashboard — contrato `DashboardItem`. */
export interface DashboardItem {
  reservaId: string;
  codigo: string;
  clienteNombre: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: string | null;
}

/** Ítem del widget "Próximos 30 días" — `DashboardItem` + color canónico (US-039). */
export interface DashboardItemProximos30Dias extends DashboardItem {
  color: ColorCalendario;
}

/** Widget genérico del dashboard: lista de ítems + recuento. */
export interface DashboardWidget<T extends DashboardItem = DashboardItem> {
  items: T[];
  total: number;
}

/** Carga agregada de los 7 widgets del dashboard operativo — `DashboardResponse`. */
export interface DashboardResultado {
  hoyManana: DashboardWidget;
  pipeline: DashboardWidget;
  subProcesosCriticos: DashboardWidget;
  pendientes: DashboardWidget;
  consultasEnCola: DashboardWidget;
  visitasProgramadas: DashboardWidget;
  proximos30Dias: DashboardWidget<DashboardItemProximos30Dias>;
}
