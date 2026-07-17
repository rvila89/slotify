/**
 * API pública del dominio de comunicaciones (US-046 · UC-36): la sección
 * "Comunicaciones" de la ficha de la RESERVA (listar, revisar/editar/enviar o
 * descartar un borrador, y crear+enviar un email manual). El resto de la app importa
 * SIEMPRE desde aquí (`@/features/comunicaciones`), nunca de archivos internos.
 */
export { ComunicacionesCard } from './components/ComunicacionesCard';
export {
  useComunicacionesReserva,
  comunicacionesReservaQueryKey,
} from './api/useComunicacionesReserva';
export { useEnviarBorrador } from './api/useEnviarBorrador';
export type { EnviarBorradorVars } from './api/useEnviarBorrador';
export { useDescartarBorrador } from './api/useDescartarBorrador';
export type { DescartarBorradorVars } from './api/useDescartarBorrador';
export { useCrearEmailManual } from './api/useCrearEmailManual';
export type { CrearEmailManualVars } from './api/useCrearEmailManual';
export type {
  Comunicacion,
  ComunicacionListItem,
  EstadoComunicacion,
  CodigoEmail,
  EnviarBorradorError,
  DescartarBorradorError,
  CrearEmailManualError,
} from './model/types';
