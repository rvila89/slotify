/**
 * Mapa DECLARATIVO estado → columna del Kanban de pipeline (US-050 · UC-37, D-2).
 *
 * Coherente con `CLAUDE.md §Máquina de estados`: la agrupación de las 5 fases se
 * modela como una estructura de datos, no como condicionales dispersos. Una
 * reserva se ubica por `subEstado` cuando `estado` es una consulta (los `2x`), y
 * por `estado` en el resto. Los estados terminales/cerrados NO tienen columna
 * (defensivo: `GET /reservas` ya los excluye, pero si llegara uno se omite).
 *
 * Los `dotColor` son los tokens Figma del node 0:523 (US-050 §Tokens de diseño).
 */
import type { Reserva } from '../model/types';

/** Identificadores estables de las 5 columnas del Kanban (orden del pipeline). */
export type ColumnaId =
  | 'consulta'
  | 'pre_reserva'
  | 'confirmada'
  | 'en_curso'
  | 'post_evento';

export type ColumnaKanban = {
  id: ColumnaId;
  label: string;
  /** Color del dot de la cabecera (token Figma node 0:523). */
  dotColor: string;
};

/**
 * Las 5 columnas en orden: Consulta · Pre-reserva · Confirmada · En Curso ·
 * Post-evento. Estructura de datos declarativa (única fuente de la vista).
 */
export const COLUMNAS_KANBAN: readonly ColumnaKanban[] = [
  { id: 'consulta', label: 'Consulta', dotColor: '#6a5c52' },
  { id: 'pre_reserva', label: 'Pre-reserva', dotColor: '#d98b74' },
  { id: 'confirmada', label: 'Confirmada', dotColor: '#8d4d39' },
  { id: 'en_curso', label: 'En Curso', dotColor: '#8d4d39' },
  { id: 'post_evento', label: 'Post-evento', dotColor: '#6a5c52' },
];

/** Sub-estados de consulta activos que caen en la columna "Consulta". */
const SUB_ESTADOS_CONSULTA_ACTIVOS = ['2a', '2b', '2c', '2d', '2v'] as const;

/** Estado del pipeline → columna (excluye consulta, que resuelve por subEstado). */
const ESTADO_A_COLUMNA: Partial<Record<Reserva['estado'], ColumnaId>> = {
  pre_reserva: 'pre_reserva',
  reserva_confirmada: 'confirmada',
  evento_en_curso: 'en_curso',
  post_evento: 'post_evento',
};

/**
 * Ubica una reserva en su columna del Kanban. Por `subEstado` cuando es consulta
 * activa (`2a`/`2b`/`2c`/`2d`/`2v`) y por `estado` en el resto. Devuelve `null`
 * para consultas terminales (`2x`/`2y`/`2z`) y estados cerrados
 * (`reserva_completada`/`reserva_cancelada`), que no tienen columna.
 */
export const columnaDeReserva = (reserva: Reserva): ColumnaId | null => {
  if (reserva.estado === 'consulta') {
    const sub = reserva.subEstado;
    return sub && SUB_ESTADOS_CONSULTA_ACTIVOS.includes(sub as (typeof SUB_ESTADOS_CONSULTA_ACTIVOS)[number])
      ? 'consulta'
      : null;
  }
  return ESTADO_A_COLUMNA[reserva.estado] ?? null;
};

/** Agrupación de reservas indexada por `ColumnaId`. */
export type ReservasPorColumna = Record<ColumnaId, Reserva[]>;

/**
 * Agrupa una lista de reservas en las 5 columnas. Las que no mapean a ninguna
 * columna (terminales/cerradas) se omiten silenciosamente.
 */
export const agruparPorColumna = (reservas: Reserva[]): ReservasPorColumna => {
  const grupos = Object.fromEntries(
    COLUMNAS_KANBAN.map((c) => [c.id, [] as Reserva[]]),
  ) as ReservasPorColumna;

  for (const reserva of reservas) {
    const columna = columnaDeReserva(reserva);
    if (columna) grupos[columna].push(reserva);
  }
  return grupos;
};
