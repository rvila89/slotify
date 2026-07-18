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
export { useEditarConsulta } from './api/useEditarConsulta';
export type { EditarConsultaError, EditarConsultaVars } from './api/useEditarConsulta';
export { useCambiarFecha } from './api/useCambiarFecha';
export type { CambiarFechaError, CambiarFechaVars } from './api/useCambiarFecha';
export { esConsultaTerminal } from './lib/estadoTerminal';
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
export { useForzarInicioEvento } from './api/useForzarInicioEvento';
export type {
  ForzarInicioEventoError,
  ForzarInicioEventoVars,
} from './api/useForzarInicioEvento';
export {
  puedeForzarInicioEvento,
  precondicionesIncumplidas,
  etiquetaPrecondicionIncumplida,
} from './lib/forzarInicioEvento';
export type { PrecondicionInicioEvento } from './lib/forzarInicioEvento';
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
export { useDescartarConsulta } from './api/useDescartarConsulta';
export type {
  DescartarConsultaError,
  DescartarConsultaVars,
} from './api/useDescartarConsulta';
export { puedeDescartarConsulta, MENSAJE_DESCARTE_TERMINAL } from './lib/descartarConsulta';
export { IbanDevolucionCard } from './components/IbanDevolucionCard';
export { puedeRegistrarIban, tieneFianza } from './lib/ibanDevolucion';
export { esIbanValido, normalizarIban } from './lib/iban';
