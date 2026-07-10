/**
 * Reglas de cliente de la acción "Registrar IBAN de devolución" (US-035 · UC-26/
 * UC-27, FA-04). Espejo de la precondición dual del backend: la acción SOLO está
 * disponible cuando `RESERVA.estado = 'post_evento'` **Y** `RESERVA.fianza_eur > 0`.
 * En cualquier otra combinación el campo IBAN no se ofrece. El servidor revalida de
 * forma defensiva (409 `estado_no_post_evento` / `sin_fianza`) — la UI no es la
 * fuente de verdad.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];
/** `Importe` es un string Decimal(10,2) (p. ej. "1000.00") o null/undefined. */
type Importe = components['schemas']['Importe'];

/** `true` si la fianza cobrada es estrictamente > 0 (acepta `Importe` string). */
export const tieneFianza = (fianzaEur: Importe | null | undefined): boolean => {
  if (fianzaEur === null || fianzaEur === undefined) return false;
  const valor = Number(fianzaEur);
  return Number.isFinite(valor) && valor > 0;
};

/**
 * La acción "Registrar IBAN de devolución" solo aplica en `post_evento` con fianza
 * cobrada (`fianza_eur > 0`). FA-04: sin fianza o fuera de `post_evento` no se ofrece.
 */
export const puedeRegistrarIban = (
  estado: EstadoReserva | undefined,
  fianzaEur: Importe | null | undefined,
): boolean => estado === 'post_evento' && tieneFianza(fianzaEur);
