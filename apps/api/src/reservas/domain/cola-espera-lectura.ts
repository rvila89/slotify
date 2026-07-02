/**
 * DOMINIO PURO del read model de la vista de cola de espera (US-017 / UC-11).
 *
 * Modela la proyección de SOLO LECTURA de la cola de una fecha (bloqueante + cola
 * FIFO) y las funciones puras de DERIVACIÓN TEMPORAL (`ttlRestante`, `tiempoEnCola`).
 *
 * Regla anti off-by-one de TZ (memoria "TTL display timezone off-by-one"): los
 * derivados se calculan SOBRE INSTANTES `Date`/timestamptz (delta entre dos
 * instantes), NUNCA formateando strings de fecha. El "ahora" se INYECTA como
 * instante (reloj), no se llama a `new Date()` dentro de la lógica pura, de modo que
 * el cálculo es determinista y unit-testeable sin BD.
 *
 * Hexagonal (hook `no-infra-in-domain`): NO importa `@nestjs/*`, Prisma ni
 * infraestructura. Reutiliza el vocabulario de cola de `promocion-cola.ts`
 * (`reservaId`/`posicionCola`/`subEstado`) para que back de lectura y de promoción
 * hablen el mismo lenguaje.
 */
import type { SubEstadoConsulta } from './maquina-estados';

/** Sección de la consulta BLOQUEANTE dentro del read model (contrato `ColaBloqueante`). */
export interface BloqueanteLectura {
  idReserva: string;
  codigo: string;
  clienteNombre: string;
  /** Sub-estado real de la bloqueante: `2b` | `2c` | `2v`. */
  subEstado: SubEstadoConsulta;
  /** Instante crudo de expiración del bloqueo blando; `null` si no tiene TTL. */
  ttlExpiracion: Date | null;
  /** TTL restante legible derivado (`ttlExpiracion − now()`); `null` si no hay TTL. */
  ttlRestante: string | null;
  /** Fecha de la visita programada; solo presente (no `null`) cuando `subEstado` es `2v`. */
  visitaProgramadaFecha: Date | null;
}

/** Elemento de la cola FIFO (contrato `ColaItem`, superset con `fechaCreacion`/`tiempoEnCola`). */
export interface ColaItemLectura {
  idReserva: string;
  codigo: string;
  clienteNombre: string;
  /** Posición FIFO en la cola (1 = primera en promocionarse). */
  posicionCola: number;
  /** Instante crudo de creación de la RESERVA en cola (`timestamptz`). */
  fechaCreacion: Date;
  /** Tiempo en cola legible derivado (`now() − fechaCreacion`). */
  tiempoEnCola: string;
}

/**
 * Read model de la cola de espera de una fecha (contrato `ColaEsperaResponse`).
 * En FA-04 (la reserva no bloquea ninguna fecha activa): `estaBloqueada = false`,
 * `bloqueante = null`, `cola = []`.
 */
export interface ColaEsperaLectura {
  estaBloqueada: boolean;
  bloqueante: BloqueanteLectura | null;
  cola: ColaItemLectura[];
}

const MS_POR_MINUTO = 60 * 1000;
const MINUTOS_POR_HORA = 60;

/**
 * Formatea un delta positivo de milisegundos entre dos instantes a texto legible:
 * horas (`"N h"`) cuando el delta llega a 1 h, minutos (`"N min"`) por debajo.
 * Opera solo sobre el delta numérico de instantes (no sobre fechas formateadas).
 */
const formatearDelta = (deltaMs: number): string => {
  const minutosTotales = Math.floor(deltaMs / MS_POR_MINUTO);
  if (minutosTotales >= MINUTOS_POR_HORA) {
    const horas = Math.floor(minutosTotales / MINUTOS_POR_HORA);
    return `${horas} h`;
  }
  return `${minutosTotales} min`;
};

/**
 * TTL restante de la bloqueante = `ttl − ahora`, calculado sobre INSTANTES. Devuelve
 * `null` cuando la bloqueante no tiene `ttl` (regla del spec). El "ahora" se inyecta.
 */
export const derivarTtlRestante = (
  ttl: Date | null,
  ahora: Date,
): string | null => {
  if (ttl === null) {
    return null;
  }
  return formatearDelta(ttl.getTime() - ahora.getTime());
};

/**
 * Tiempo en cola de una RESERVA en `2.d` = `ahora − fechaCreacion`, calculado sobre
 * INSTANTES. El "ahora" se inyecta (reloj), no se lee dentro de la función.
 */
export const derivarTiempoEnCola = (creacion: Date, ahora: Date): string =>
  formatearDelta(ahora.getTime() - creacion.getTime());
