/**
 * API pública del dominio Dashboard operativo (US-044). El resto de la app
 * importa SIEMPRE desde aquí (`@/features/dashboard`), nunca de archivos
 * internos. Vista de lectura pura (UC-34) montada en `/dashboard`.
 */
export { DashboardPage } from './pages/DashboardPage';
export { useDashboard, dashboardQueryKey, DashboardError } from './api/useDashboard';
export type {
  DashboardResponse,
  DashboardWidget,
  DashboardItem,
} from './model/types';
