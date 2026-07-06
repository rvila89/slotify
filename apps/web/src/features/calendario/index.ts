/**
 * API pública del dominio de calendario (US-039). El resto de la app importa
 * SIEMPRE desde aquí (`@/features/calendario`), nunca de archivos internos.
 */
export { CalendarioPage } from './pages/CalendarioPage';
export { useCalendario, calendarioQueryKey } from './api/useCalendario';
// Mapa cromático canónico (US-039 §11.3). Se reexpone por el barrel para que
// otras features (p. ej. Dashboard US-044, widget `proximos30Dias`) reutilicen
// la MISMA tabla color→clases en vez de reimplementarla (design US-044 §D-2).
export { ESTILO_COLOR, ORDEN_LEYENDA } from './lib/colores';
export type {
  CalendarioFecha,
  CalendarioResponse,
  ColorCalendario,
  VistaCalendario,
} from './model/types';
