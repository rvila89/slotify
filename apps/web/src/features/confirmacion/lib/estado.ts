/**
 * Guarda de cliente para la acción "Confirmar pago de señal" (US-021 · UC-17).
 * Espejo de la guarda de origen declarativa del backend: la confirmación solo se
 * ofrece sobre una RESERVA en `estado='pre_reserva'`. Cualquier sub-estado de
 * `consulta`, `reserva_confirmada`+ o `reserva_cancelada` queda fuera. Es solo
 * para habilitar/mostrar la acción; el servidor revalida de forma defensiva
 * (422 "La reserva no está en estado pre_reserva").
 */
type ReservaGuarda = {
  estado?: string;
};

/** Indica si la RESERVA es un origen válido de estado para confirmar la señal. */
export const puedeConfirmarSenal = (reserva: ReservaGuarda): boolean =>
  reserva.estado === 'pre_reserva';
