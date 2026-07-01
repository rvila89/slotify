/**
 * API pública del dominio de calendario (US-039). El resto de la app importa
 * SIEMPRE desde aquí (`@/features/calendario`), nunca de archivos internos.
 */
export { CalendarioPage } from './pages/CalendarioPage';
export { useCalendario, calendarioQueryKey } from './api/useCalendario';
export type {
  CalendarioFecha,
  CalendarioResponse,
  ColorCalendario,
  VistaCalendario,
} from './model/types';
