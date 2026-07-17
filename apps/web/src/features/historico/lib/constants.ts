import type { EstadoFinal, FiltrosHistorico, TipoEvento } from '../model/types';

/**
 * Paginación por defecto del histórico, espejo del contrato (`page=1`,
 * `limit=20`; `limit` válido 1..100). Es el estado inicial de filtros y el
 * destino de "Limpiar filtros" (FA edge case a).
 */
export const HISTORICO_LIMIT_DEFAULT = 20;

/** Filtros iniciales: sin búsqueda ni filtros estructurados, página 1. */
export const FILTROS_INICIALES: FiltrosHistorico = {
  page: 1,
  limit: HISTORICO_LIMIT_DEFAULT,
};

/**
 * Opciones del filtro de estado final. Ausente (`''`) → el backend devuelve
 * SOLO `reserva_completada`; `reserva_cancelada` es opt-in explícito (D-3).
 */
export const ESTADO_FINAL_OPCIONES: { value: EstadoFinal; label: string }[] = [
  { value: 'reserva_completada', label: 'Completadas' },
  { value: 'reserva_cancelada', label: 'Canceladas' },
];

/** Etiquetas legibles del estado cerrado para badges de la tabla/detalle. */
export const ESTADO_FINAL_LABEL: Record<EstadoFinal, string> = {
  reserva_completada: 'Completada',
  reserva_cancelada: 'Cancelada',
};

/** Opciones del filtro de tipo de evento (espejo del contrato `TipoEvento`). */
export const TIPO_EVENTO_OPCIONES: { value: TipoEvento; label: string }[] = [
  { value: 'boda', label: 'Boda' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'privado', label: 'Privado' },
  { value: 'cumpleanos', label: 'Cumpleaños' },
  { value: 'otro', label: 'Otro' },
];

/** Etiqueta legible de un tipo de evento (para la columna de la tabla). */
export const etiquetaTipoEvento = (tipo?: TipoEvento | null): string =>
  TIPO_EVENTO_OPCIONES.find((t) => t.value === tipo)?.label ?? '—';
