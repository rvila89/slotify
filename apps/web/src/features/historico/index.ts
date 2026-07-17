/**
 * API pública del dominio de histórico (US-042). El resto de la app importa
 * SIEMPRE desde aquí (`@/features/historico`), nunca de archivos internos del
 * dominio.
 */
export { HistoricoPage } from './pages/HistoricoPage';
export { DetalleHistoricoPage } from './pages/DetalleHistorico/DetalleHistoricoPage';
export { useHistorico, historicoQueryKey } from './api/useHistorico';
export type { HistoricoResultado } from './api/useHistorico';
export type {
  FiltrosHistorico,
  ReservaHistorico,
  EstadoFinal,
} from './model/types';
export { construirQuery, hayFiltrosActivos, filtrosLimpios } from './lib/filtros';
export type { HistoricoQuery } from './lib/filtros';
export { FILTROS_INICIALES, etiquetaTipoEvento } from './lib/constants';
export { segmentosDestacados } from './lib/destacar';
export type { SegmentoDestacado } from './lib/destacar';
export { formatearFechaEvento, formatearImporte, nombreCliente } from './lib/formato';
export { HistoricoTabla } from './components/HistoricoTabla';
export { HistoricoFiltros } from './components/HistoricoFiltros';
export { HistoricoPaginacion } from './components/HistoricoPaginacion';
