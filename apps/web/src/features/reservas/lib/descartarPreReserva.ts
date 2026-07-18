/**
 * Reglas de cliente de la acción "Descartar pre-reserva" (workstream B de
 * `presupuesto-prereserva-cta-descarte-y-e2`). Espejo, en fase `pre_reserva`, del
 * descarte manual de una consulta (US-013): el gestor cierra la pre-reserva a mano,
 * liberando la fecha y promoviendo la cola, en vez de esperar a la expiración de TTL.
 *
 * Guarda de origen mono-origen, calcada de la guarda declarativa del backend
 * (`ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado:
 * null }]`): la transición `pre_reserva → reserva_cancelada` SOLO aplica cuando la
 * RESERVA está en `pre_reserva`. En cualquier otro estado (consulta y sus
 * sub-estados, `reserva_confirmada` y posteriores, o los terminales
 * `reserva_cancelada`/`reserva_completada`) la acción NO se ofrece; el servidor
 * revalida de forma defensiva (422 origen inválido / 409 terminal o carrera perdida).
 *
 * `components/` aloja SOLO `.tsx` (regla dura del proyecto): esta guarda y sus
 * constantes viven en `lib/`.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];

/**
 * Mensaje del 409 (RESERVA ya terminal / doble descarte / carrera perdida contra la
 * expiración de TTL de la pre-reserva), coherente con el contrato.
 */
export const MENSAJE_DESCARTE_PRERESERVA_TERMINAL =
  'Esta reserva ya está en un estado terminal y no puede descartarse';

/** La acción "Descartar pre-reserva" solo aplica cuando la RESERVA está en `pre_reserva`. */
export const puedeDescartarPreReserva = ({
  estado,
}: {
  estado: EstadoReserva | undefined;
}): boolean => estado === 'pre_reserva';
