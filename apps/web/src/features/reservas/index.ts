/**
 * API pública del dominio de reservas. El resto de la app importa SIEMPRE desde
 * aquí (`@/features/reservas`), nunca de archivos internos del dominio.
 */
export { NuevaConsultaPage } from './pages/NuevaConsulta/NuevaConsultaPage';
export { FichaConsultaPage } from './pages/FichaConsulta/FichaConsultaPage';
export { useReserva, reservaQueryKey } from './api/useReserva';
export { useAsignarFecha } from './api/useAsignarFecha';
export type { AsignarFechaError, AsignarFechaVars } from './api/useAsignarFecha';
