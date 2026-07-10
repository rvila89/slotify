/**
 * API pública del dominio de reservas. El resto de la app importa SIEMPRE desde
 * aquí (`@/features/reservas`), nunca de archivos internos del dominio.
 */
export { NuevaConsultaPage } from './pages/NuevaConsulta/NuevaConsultaPage';
export { FichaConsultaPage } from './pages/FichaConsulta/FichaConsultaPage';
export { ReservasPage } from './pages/ReservasPage/ReservasPage';
export { ReservaKanbanCard } from './pages/ReservasPage/components/ReservaKanbanCard';
export { ListadoView } from './pages/ReservasPage/components/ListadoView';
export { useReservasActivas, reservasActivasQueryKey } from './api/useReservasActivas';
export type { Reserva, ReservaDetalle } from './model/types';
export { useReserva, reservaQueryKey } from './api/useReserva';
export { useAsignarFecha } from './api/useAsignarFecha';
export type { AsignarFechaError, AsignarFechaVars } from './api/useAsignarFecha';
export { usePendienteInvitados } from './api/usePendienteInvitados';
export type {
  PendienteInvitadosError,
  PendienteInvitadosVars,
} from './api/usePendienteInvitados';
export { useProgramarVisita } from './api/useProgramarVisita';
export type {
  ProgramarVisitaError,
  ProgramarVisitaVars,
} from './api/useProgramarVisita';
export { useRegistrarResultadoVisita } from './api/useRegistrarResultadoVisita';
export type {
  RegistrarResultadoVisitaError,
  RegistrarResultadoVisitaVars,
} from './api/useRegistrarResultadoVisita';
export {
  camposObligatoriosFaltantes,
  ETIQUETA_CAMPO_OBLIGATORIO,
} from './lib/datosObligatorios';
export type { CampoObligatorio } from './lib/datosObligatorios';
export { useExtenderBloqueo } from './api/useExtenderBloqueo';
export type {
  ExtenderBloqueoError,
  ExtenderBloqueoVars,
} from './api/useExtenderBloqueo';
export { useFinalizarEvento } from './api/useFinalizarEvento';
export type {
  FinalizarEventoError,
  FinalizarEventoVars,
} from './api/useFinalizarEvento';
export {
  puedeFinalizarEvento,
  etiquetaDocumentacionPendiente,
} from './lib/finalizarEvento';
export { useArchivarReserva } from './api/useArchivarReserva';
export type {
  ArchivarReservaError,
  ArchivarReservaVars,
} from './api/useArchivarReserva';
export {
  puedeArchivarReserva,
  fianzaResueltaCliente,
  motivoArchivarBloqueado,
  MENSAJE_FIANZA_NO_RESUELTA,
} from './lib/archivarReserva';
export { useRegistrarIbanDevolucion } from './api/useRegistrarIbanDevolucion';
export type {
  RegistrarIbanError,
  RegistrarIbanDevolucionVars,
} from './api/useRegistrarIbanDevolucion';
export { IbanDevolucionCard } from './components/IbanDevolucionCard';
export { puedeRegistrarIban, tieneFianza } from './lib/ibanDevolucion';
export { esIbanValido, normalizarIban } from './lib/iban';
