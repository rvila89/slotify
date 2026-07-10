/**
 * Reglas de cliente de la **devolución de fianza** (US-036 · UC-27). Espejo de la lógica de
 * dominio del backend, para dar feedback inmediato en la UI; el servidor es la fuente de verdad
 * y revalida (400 `IMPORTE_SUPERA_FIANZA` / `FECHA_DEVOLUCION_INVALIDA` / `MOTIVO_RETENCION_REQUERIDO`,
 * 409 `PRECONDICION_NO_CUMPLIDA`).
 *
 * Los importes viajan como `Importe` (string Decimal(10,2), p. ej. "1000.00"). Para comparar sin
 * errores de coma flotante se normalizan a **céntimos enteros** antes de comparar.
 */
import type { components } from '@/api-client';

type Importe = components['schemas']['Importe'];
type EstadoReserva = components['schemas']['EstadoReserva'];
type FianzaStatus = components['schemas']['FianzaStatus'];

/** Estado final derivado de la devolución (mismo enum del contrato para `fianzaStatus`). */
export type ResultadoDevolucion = 'devuelta' | 'retenida_parcial';

/**
 * Convierte un `Importe` (string decimal) o número a céntimos enteros; `null` si no es un número
 * finito. Redondea al céntimo más próximo para evitar arrastres de coma flotante ("1000.00" → 100000).
 */
export const aCentimos = (importe: Importe | string | number | null | undefined): number | null => {
  if (importe === null || importe === undefined || importe === '') return null;
  const valor = typeof importe === 'number' ? importe : Number(importe);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
};

/**
 * Deriva el estado final de la fianza a partir del importe devuelto y la fianza cobrada
 * (regla de dominio pura, D-3): `importe == fianzaEur` ⇒ `devuelta`; `importe < fianzaEur`
 * (incluido 0) ⇒ `retenida_parcial`. Devuelve `null` si no puede compararse (datos ausentes).
 */
export const derivarResultadoDevolucion = (
  importeDevuelto: Importe | string | number | null | undefined,
  fianzaEur: Importe | null | undefined,
): ResultadoDevolucion | null => {
  const importe = aCentimos(importeDevuelto);
  const tope = aCentimos(fianzaEur);
  if (importe === null || tope === null) return null;
  if (importe > tope) return null; // importe inválido (FA-02): no se deriva estado
  return importe === tope ? 'devuelta' : 'retenida_parcial';
};

/** `true` si el importe devuelto es estrictamente menor que la fianza (⇒ retención → motivo requerido). */
export const esDevolucionParcial = (
  importeDevuelto: Importe | string | number | null | undefined,
  fianzaEur: Importe | null | undefined,
): boolean => derivarResultadoDevolucion(importeDevuelto, fianzaEur) === 'retenida_parcial';

/**
 * Precondición triple de disponibilidad de la acción (espejo del backend, D-4): SOLO disponible
 * cuando `estado = 'post_evento'` **Y** `fianzaStatus = 'cobrada'` **Y** `ibanDevolucion` presente.
 * El servidor revalida (409 `PRECONDICION_NO_CUMPLIDA`); la UI no es la fuente de verdad.
 */
export const puedeRegistrarDevolucion = (
  estado: EstadoReserva | undefined,
  fianzaStatus: FianzaStatus | undefined,
  ibanDevolucion: string | null | undefined,
): boolean =>
  estado === 'post_evento' && fianzaStatus === 'cobrada' && Boolean(ibanDevolucion?.trim());

/** `true` si la fianza ya está en un estado final (devolución ya registrada, acción irreversible). */
export const devolucionYaRegistrada = (fianzaStatus: FianzaStatus | undefined): boolean =>
  fianzaStatus === 'devuelta' || fianzaStatus === 'retenida_parcial';
