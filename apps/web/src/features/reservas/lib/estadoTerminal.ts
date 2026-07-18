/**
 * Predicados de "consulta cerrada" (US-051 §Punto 4). Una RESERVA está en un
 * estado terminal cuando su sub-estado de consulta es terminal (`2x`/`2y`/`2z`) o
 * cuando su estado es un estado terminal de la máquina (`reserva_cancelada`,
 * `reserva_completada`). En esos casos la ficha NO ofrece ninguna acción —ni
 * siquiera deshabilitada—, solo el fallback "No hay acciones disponibles".
 *
 * `components/` aloja SOLO `.tsx` (regla dura del proyecto): esta guarda vive en
 * `lib/`.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];
type SubEstadoConsulta = components['schemas']['SubEstadoConsulta'];

/** Sub-estados de consulta terminales (cerrados, inmutables). */
const SUB_ESTADOS_TERMINALES: readonly SubEstadoConsulta[] = ['2x', '2y', '2z'];

/** Estados de la máquina que son terminales (la RESERVA ya no admite acciones). */
const ESTADOS_TERMINALES: readonly EstadoReserva[] = ['reserva_cancelada', 'reserva_completada'];

/**
 * Indica si la RESERVA está en un estado o sub-estado terminal, en cuyo caso la
 * ficha no debe renderizar ninguna acción (US-051 §Punto 4).
 */
export const esConsultaTerminal = (reserva: {
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
}): boolean => {
  if (reserva.estado != null && ESTADOS_TERMINALES.includes(reserva.estado)) return true;
  return reserva.subEstado != null && SUB_ESTADOS_TERMINALES.includes(reserva.subEstado);
};
