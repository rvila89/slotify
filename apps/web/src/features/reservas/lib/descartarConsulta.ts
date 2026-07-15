/**
 * Reglas de cliente de la acción "Marcar como descartada por cliente" (US-013 ·
 * UC-10, A17 manual). Espejo de la guarda de origen del backend (design.md §D-1):
 * la transición a `2z` SOLO aplica cuando la RESERVA está en fase `consulta` con un
 * sub_estado **no terminal** (`2a/2b/2c/2d/2v`). En cualquier sub_estado terminal
 * (`2x/2y/2z`) o estado terminal (`reserva_cancelada/reserva_completada`) la acción
 * se ofrece **deshabilitada**; el servidor revalida siempre de forma defensiva
 * (409 `transicion_no_permitida`, RC-3 / RC-1).
 *
 * `components/` aloja SOLO `.tsx` (regla dura del proyecto): esta guarda y sus
 * constantes viven en `lib/`.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];
type SubEstadoConsulta = components['schemas']['SubEstadoConsulta'];

/** Mensaje del 409 (RC-3 doble descarte / origen terminal), idéntico al contrato. */
export const MENSAJE_DESCARTE_TERMINAL =
  'Esta consulta ya está en un estado terminal y no puede modificarse';

/** Sub_estados de consulta desde los que el descarte por cliente es válido. */
const SUB_ESTADOS_DESCARTABLES: readonly SubEstadoConsulta[] = ['2a', '2b', '2c', '2d', '2v'];

/**
 * La acción "Marcar como descartada por cliente" solo aplica en fase `consulta`
 * con un sub_estado no terminal (`2a/2b/2c/2d/2v`). Fuera de fase `consulta`
 * (pre_reserva y posteriores) la consulta ya no es un lead descartable por el
 * cliente, y los sub_estados terminales (`2x/2y/2z`) son inmutables.
 */
export const puedeDescartarConsulta = (
  estado: EstadoReserva | undefined,
  subEstado: SubEstadoConsulta | null | undefined,
): boolean =>
  estado === 'consulta' &&
  subEstado != null &&
  SUB_ESTADOS_DESCARTABLES.includes(subEstado);
