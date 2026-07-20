/**
 * Etiqueta legible del ESTADO PRINCIPAL de una reserva para el `Badge` de la ficha
 * (change `presupuesto-confirmar-ux-e2-idioma`, workstream C).
 *
 * Reutiliza la única fuente de verdad de la vista de pipeline: `columnaDeReserva`
 * (estado → columna del Kanban) + los `label` de `COLUMNAS_KANBAN`. Así
 * `pre_reserva → «Pre-reserva»`, `reserva_confirmada → «Confirmada»`,
 * `evento_en_curso → «En Curso»`, `post_evento → «Post-evento»` sin duplicar
 * cadenas. Los estados TERMINALES no tienen columna en el pipeline pero SÍ deben
 * etiquetarse en la ficha (el estado ha de verse SIEMPRE): `reserva_cancelada →
 * «Cancelada»`, `reserva_completada → «Completada»`. Solo `consulta` sin
 * sub-estado activo devuelve `null` (la ficha usa el sub-estado en las consultas).
 */
import type { Reserva } from '../model/types';
import { COLUMNAS_KANBAN, columnaDeReserva } from './columnasKanban';

const LABEL_POR_COLUMNA: Record<string, string> = Object.fromEntries(
  COLUMNAS_KANBAN.map((columna) => [columna.id, columna.label]),
);

/** Etiquetas de los estados terminales (sin columna en el pipeline). */
const LABEL_TERMINAL: Partial<Record<Reserva['estado'], string>> = {
  reserva_cancelada: 'Cancelada',
  reserva_completada: 'Completada',
};

/**
 * Devuelve la etiqueta del estado principal para el badge: fases del pipeline
 * (`«Pre-reserva»`, `«Confirmada»`, `«En Curso»`, `«Post-evento»`) reutilizando
 * `COLUMNAS_KANBAN`, y estados terminales (`«Cancelada»`, `«Completada»`). Devuelve
 * `null` solo para `consulta` (que se etiqueta por sub-estado en la ficha).
 */
export const etiquetaEstadoPrincipal = (estado: Reserva['estado']): string | null => {
  const columna = columnaDeReserva({ estado } as Reserva);
  if (columna) return LABEL_POR_COLUMNA[columna] ?? null;
  return LABEL_TERMINAL[estado] ?? null;
};
