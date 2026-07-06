import type { Reserva } from '../../model/types';
import { COLUMNAS_KANBAN, columnaDeReserva } from '../../lib/columnasKanban';

/**
 * Etiqueta legible de la fase de una reserva para la columna "Estado" del
 * Listado (US-050 · UC-38). Reutiliza el mapa declarativo de columnas del
 * Kanban (D-2) para que ambas vistas hablen el mismo lenguaje de fases; si por
 * robustez llegara un estado sin columna, cae al propio `estado` crudo.
 */
export const etiquetaEstado = (reserva: Reserva): string => {
  const columnaId = columnaDeReserva(reserva);
  const columna = COLUMNAS_KANBAN.find((c) => c.id === columnaId);
  return columna?.label ?? reserva.estado;
};
