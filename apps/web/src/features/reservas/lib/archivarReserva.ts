/**
 * Reglas de cliente de la acción "Archivar reserva" (US-038 · UC-28, flujo manual).
 * Espejo de la guarda de origen declarativa del backend (`post_evento →
 * reserva_completada`, la misma que introdujo US-037): la acción SOLO está
 * disponible cuando `RESERVA.estado = post_evento`; en cualquier otro estado no se
 * ofrece. El servidor revalida de forma defensiva (409 `transicion_no_permitida`).
 *
 * Además reproduce en cliente la **guarda de fianza resuelta** de US-037/US-036
 * (defensa en UI, el backend valida igualmente — 422 `fianza_no_resuelta`): la
 * fianza está resuelta si `fianzaStatus === 'devuelta'` O `fianzaEur ≤ 0` O
 * `fianzaEur == null`. Si NO está resuelta, la acción se ofrece **deshabilitada**
 * con el motivo específico (FA-01/FA-02). Tras
 * fix-liquidacion-fianza-independientes la devolución es siempre completa (no hay
 * `retenida_parcial`).
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];
type FianzaStatus = components['schemas']['FianzaStatus'];
type Importe = components['schemas']['Importe'];

/** Mensaje de bloqueo por fianza no resuelta (FA-01/FA-02, idéntico al backend). */
export const MENSAJE_FIANZA_NO_RESUELTA =
  'No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar.';

/** La acción "Archivar reserva" solo aplica en `post_evento`. */
export const puedeArchivarReserva = (estado: EstadoReserva | undefined): boolean =>
  estado === 'post_evento';

/**
 * Guarda de fianza resuelta (espejo de `fianzaResuelta` de US-037). Resuelta si el
 * importe es nulo/≤0 (sin fianza que resolver, no se evalúa el status) o si el
 * status es `devuelta`. Tras fix-liquidacion-fianza-independientes la devolución es
 * siempre completa (no existe `retenida_parcial`).
 */
export const fianzaResueltaCliente = (
  fianzaStatus: FianzaStatus | undefined,
  fianzaEur: Importe | null | undefined,
): boolean => {
  const importe = fianzaEur == null ? 0 : Number(fianzaEur);
  if (Number.isNaN(importe) || importe <= 0) return true;
  return fianzaStatus === 'devuelta';
};

/**
 * Motivo por el que el botón "Archivar reserva" está deshabilitado, o `null` si la
 * acción está habilitada. Solo se llama cuando la reserva está en `post_evento`.
 */
export const motivoArchivarBloqueado = (
  fianzaStatus: FianzaStatus | undefined,
  fianzaEur: Importe | null | undefined,
): string | null =>
  fianzaResueltaCliente(fianzaStatus, fianzaEur) ? null : MENSAJE_FIANZA_NO_RESUELTA;
