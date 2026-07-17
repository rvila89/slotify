import type { FiltrosHistorico } from '../model/types';
import { FILTROS_INICIALES } from './constants';

/** Query params del SDK `listarHistorico` (todos opcionales salvo paginación). */
export type HistoricoQuery = {
  page: number;
  limit: number;
  q?: string;
  estadoFinal?: FiltrosHistorico['estadoFinal'];
  fechaDesde?: string;
  fechaHasta?: string;
  tipoEvento?: FiltrosHistorico['tipoEvento'];
  importeMin?: string;
  importeMax?: string;
};

/** True si el valor es un string con contenido tras recortar espacios. */
const conTexto = (v?: string): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Traduce los filtros de UI a los query params del SDK, OMITIENDO los campos
 * vacíos para no ensuciar la URL/petición con parámetros sin valor (el backend
 * aplica el default de `estadoFinal`: ausente → solo completadas). `page`/`limit`
 * viajan siempre. `q` y los importes se recortan; los vacíos se descartan.
 */
export const construirQuery = (filtros: FiltrosHistorico): HistoricoQuery => {
  const query: HistoricoQuery = { page: filtros.page, limit: filtros.limit };
  if (conTexto(filtros.q)) query.q = filtros.q.trim();
  if (filtros.estadoFinal) query.estadoFinal = filtros.estadoFinal;
  if (conTexto(filtros.fechaDesde)) query.fechaDesde = filtros.fechaDesde;
  if (conTexto(filtros.fechaHasta)) query.fechaHasta = filtros.fechaHasta;
  if (filtros.tipoEvento) query.tipoEvento = filtros.tipoEvento;
  if (conTexto(filtros.importeMin)) query.importeMin = filtros.importeMin.trim();
  if (conTexto(filtros.importeMax)) query.importeMax = filtros.importeMax.trim();
  return query;
};

/**
 * True si hay algún filtro estructurado o búsqueda activos (más allá de la
 * paginación). Diferencia el estado vacío "sin resultados por filtro" (edge
 * case a) del "histórico vacío del tenant" (edge case c): si no hay filtros
 * activos y no hay datos, el tenant no tiene histórico.
 */
export const hayFiltrosActivos = (filtros: FiltrosHistorico): boolean =>
  conTexto(filtros.q) ||
  Boolean(filtros.estadoFinal) ||
  conTexto(filtros.fechaDesde) ||
  conTexto(filtros.fechaHasta) ||
  Boolean(filtros.tipoEvento) ||
  conTexto(filtros.importeMin) ||
  conTexto(filtros.importeMax);

/** Restaura los filtros a su valor inicial (destino de "Limpiar filtros"). */
export const filtrosLimpios = (): FiltrosHistorico => ({ ...FILTROS_INICIALES });
