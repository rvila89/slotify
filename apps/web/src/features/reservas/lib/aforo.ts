/**
 * Helper de aforo/pax de una reserva (US-050, D-1). El aforo mostrado en la
 * tarjeta del Kanban y en la columna "Aforo" del Listado es `numInvitadosFinal`
 * cuando está presente; si no, la suma del desglose
 * `numAdultosNinosMayores4 + numNinosMenores4`. Devuelve `null` cuando no hay
 * ningún dato de aforo, para que la UI pueda omitir el pax.
 */
import type { Reserva } from '../model/types';

export const aforoDeReserva = (reserva: Reserva): number | null => {
  if (reserva.numInvitadosFinal != null) return reserva.numInvitadosFinal;

  const adultos = reserva.numAdultosNinosMayores4;
  const ninos = reserva.numNinosMenores4;
  if (adultos == null && ninos == null) return null;
  return (adultos ?? 0) + (ninos ?? 0);
};
