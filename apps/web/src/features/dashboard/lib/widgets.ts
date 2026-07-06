import type { DashboardWidgetKey } from '../model/types';

/**
 * Metadatos legibles de cada widget del dashboard (US-044). Tabla declarativa
 * `clave del contrato → { titulo, descripcion, vacio }`, no condicionales
 * dispersos (coherente con "estados como estructura de datos" del CLAUDE.md).
 * El orden del array fija el orden visual de la parrilla de widgets.
 */
type WidgetMeta = {
  /** Clave del widget en `DashboardResponse` (nombre del contrato OpenAPI). */
  key: DashboardWidgetKey;
  /** Título legible en español mostrado en la cabecera de la card. */
  titulo: string;
  /** Frase corta que explica el criterio del widget. */
  descripcion: string;
  /** Texto del estado vacío (`total = 0`) específico del widget. */
  vacio: string;
};

export const WIDGETS_META: readonly WidgetMeta[] = [
  {
    key: 'hoyManana',
    titulo: 'Hoy y mañana',
    descripcion: 'Eventos confirmados o en curso para hoy y mañana.',
    vacio: 'Sin eventos para hoy ni mañana',
  },
  {
    key: 'pipeline',
    titulo: 'Pipeline activo',
    descripcion: 'Reservas activas en cualquier fase del embudo.',
    vacio: 'Sin reservas en el pipeline',
  },
  {
    key: 'subProcesosCriticos',
    titulo: 'Subprocesos críticos',
    descripcion: 'Confirmadas con pre-evento, liquidación o fianza atrasados.',
    vacio: 'Sin subprocesos atrasados',
  },
  {
    key: 'pendientes',
    titulo: 'Pendientes de acción',
    descripcion: 'Presupuestos, TTL próximos a expirar y facturas vencidas.',
    vacio: 'Sin acciones pendientes',
  },
  {
    key: 'consultasEnCola',
    titulo: 'Consultas en cola',
    descripcion: 'Consultas en espera por fecha ya bloqueada.',
    vacio: 'Sin consultas en cola',
  },
  {
    key: 'visitasProgramadas',
    titulo: 'Visitas programadas',
    descripcion: 'Visitas futuras acordadas con clientes.',
    vacio: 'Sin visitas programadas',
  },
  {
    key: 'proximos30Dias',
    titulo: 'Próximos 30 días',
    descripcion: 'Eventos con fecha en los próximos 30 días.',
    vacio: 'Sin eventos en los próximos 30 días',
  },
] as const;
