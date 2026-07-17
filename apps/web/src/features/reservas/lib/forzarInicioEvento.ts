/**
 * Reglas de cliente de la acción "Forzar inicio del evento" (US-032 · UC-23 FA-01).
 * Espejo de las guardas de dominio del backend (design.md §D-6):
 *  - `puedeForzarInicioEvento`: guarda de ORIGEN + FECHA. El botón SOLO se ofrece
 *    cuando `RESERVA.estado = reserva_confirmada` **y** `fechaEvento` es hoy (fecha de
 *    calendario). Fuera de eso, no se renderiza. El servidor revalida de forma
 *    defensiva (409 `conflicto_estado` / 422 `fecha_evento_no_es_hoy`).
 *  - `precondicionesIncumplidas`: deriva en cliente la lista de sub-procesos
 *    pendientes a partir de los tres `*_status` del `ReservaDetalle`, espejo de la
 *    guarda `preconditionesEventoCumplidas` de dominio. Es SOLO presentación: el
 *    backend recalcula `faltantes` bajo el lock (fuente de verdad para el audit log).
 *
 * Toda función es una expresión de flecha (regla dura del proyecto). No se inventan
 * tipos de API: todos derivan del SDK generado.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];
type PreEventoStatus = components['schemas']['PreEventoStatus'];
type LiquidacionStatus = components['schemas']['LiquidacionStatus'];
type FianzaStatus = components['schemas']['FianzaStatus'];

/** Clave de cada precondición del inicio de evento (espejo del audit log del backend). */
export type PrecondicionInicioEvento =
  | 'pre_evento_status'
  | 'liquidacion_status'
  | 'fianza_status';

/**
 * Compara dos fechas por fecha de CALENDARIO (año-mes-día en horario local del
 * navegador), no por instante. Blinda el borde de "evento hoy a las 23:00" (sigue
 * siendo hoy) sin depender de ningún string formateado.
 */
const mismaFechaCalendario = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Guarda de cliente: el forzado SOLO se ofrece cuando la RESERVA está en
 * `reserva_confirmada` **y** la fecha del evento es hoy. `fechaEvento` puede llegar
 * `null`/`undefined` (consulta sin fecha) o como un string ISO inválido → `false`.
 * `hoy` se inyecta para poder testear con {ayer, hoy, mañana} de forma determinista.
 */
export const puedeForzarInicioEvento = (
  estado: EstadoReserva | undefined,
  fechaEvento: string | null | undefined,
  hoy: Date,
): boolean => {
  if (estado !== 'reserva_confirmada') return false;
  if (!fechaEvento) return false;
  const fecha = new Date(fechaEvento);
  if (Number.isNaN(fecha.getTime())) return false;
  return mismaFechaCalendario(fecha, hoy);
};

/** Entrada mínima para derivar las precondiciones (subconjunto de `ReservaDetalle`). */
type PrecondicionesInput = {
  preEventoStatus?: PreEventoStatus;
  liquidacionStatus?: LiquidacionStatus;
  fianzaStatus?: FianzaStatus;
};

/**
 * Deriva la lista de precondiciones INCUMPLIDAS a partir de los tres `*_status`.
 * Incumplida ⇔ `preEventoStatus ≠ 'cerrado'` / `liquidacionStatus ≠ 'cobrada'` /
 * `fianzaStatus ≠ 'cobrada'`. Un `*_status` ausente (`undefined`) se considera
 * incumplido (fail-safe: se avisa de más, nunca de menos). El orden es estable
 * (pre-evento → liquidación → fianza) para una presentación consistente.
 */
export const precondicionesIncumplidas = (
  reserva: PrecondicionesInput,
): PrecondicionInicioEvento[] => {
  const faltantes: PrecondicionInicioEvento[] = [];
  if (reserva.preEventoStatus !== 'cerrado') faltantes.push('pre_evento_status');
  if (reserva.liquidacionStatus !== 'cobrada') faltantes.push('liquidacion_status');
  if (reserva.fianzaStatus !== 'cobrada') faltantes.push('fianza_status');
  return faltantes;
};

/** Etiquetas legibles en español de cada precondición del inicio de evento. */
const ETIQUETA_PRECONDICION: Record<PrecondicionInicioEvento, string> = {
  pre_evento_status: 'Cierre del pre-evento (ficha operativa)',
  liquidacion_status: 'Cobro de la liquidación',
  fianza_status: 'Cobro de la fianza',
};

/**
 * Convierte una clave de precondición en una etiqueta legible. Fail-open: si llega
 * una clave desconocida (el backend puede añadir precondiciones), se normaliza
 * (`snake_case` → "Snake case") en vez de romper la UI.
 */
export const etiquetaPrecondicionIncumplida = (clave: string): string =>
  ETIQUETA_PRECONDICION[clave as PrecondicionInicioEvento] ??
  clave
    .replace(/[_-]+/g, ' ')
    .replace(/^\s*(.)/, (_m, primera: string) => primera.toUpperCase())
    .trim();
