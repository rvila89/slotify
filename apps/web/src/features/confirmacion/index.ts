/**
 * API pública del dominio de confirmación (US-021 · UC-17): confirmar el pago de la
 * señal y elevar la RESERVA a `reserva_confirmada`. El resto de la app importa
 * SIEMPRE desde aquí (`@/features/confirmacion`), nunca de archivos internos.
 */
export { ConfirmarSenalDialog } from './components/ConfirmarSenalDialog';
export { AvisoReservaConfirmada } from './components/AvisoReservaConfirmada';
export { puedeConfirmarSenal } from './lib/estado';
export { useConfirmarSenal } from './api/useConfirmarSenal';
export type { ConfirmarSenalVars } from './api/useConfirmarSenal';
export type { ConfirmarSenalResponse, ConfirmarSenalError } from './model/types';
