/**
 * Desglose fiscal de la factura de señal — DOMINIO PURO (US-022 / UC-18, design.md §D-2).
 *
 * Deriva la base imponible y el IVA a partir del TOTAL congelado (= RESERVA.importe_senal,
 * US-021). La factura de señal NO recalcula el porcentaje de señal ni la tarifa: el total
 * ENTRA congelado y se respeta.
 *
 *   iva_porcentaje = 21,00           (IVA general fijo del MVP)
 *   base_imponible = round(total / 1,21, 2)   (redondeo contable half-up a 2 decimales)
 *   iva_importe    = total − base_imponible    (POR RESTA, no por segundo round de la base)
 *
 * El IVA se obtiene por resta del total para que `base + iva = total` sea EXACTO a 2
 * decimales, sin descuadre de céntimos por doble redondeo. Se opera con enteros de
 * céntimos internamente (nunca float) y se devuelven strings `Decimal(…, 2)`.
 *
 * Función de flecha inmutable, sin dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Porcentaje de IVA general del MVP (Decimal(4,2) como string). */
export const IVA_PORCENTAJE_MVP = '21.00' as const;

/** Factor de IVA (1 + 21/100) para derivar la base a partir del total. */
const FACTOR_IVA = 1.21;

/** Parámetros del desglose: el total congelado (Importe string de 2 decimales). */
export interface CalcularDesgloseParams {
  total: string;
}

/** Desglose fiscal derivado del total. Importes como Decimal string de 2 decimales. */
export interface DesgloseFacturaSenal {
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** Redondeo contable half-up a `decimales` posiciones sobre un número de euros. */
const redondearHalfUp = (valor: number, decimales: number): number => {
  const factor = 10 ** decimales;
  // Épsilon para neutralizar el ruido binario de la coma flotante antes del round
  // (garantiza half-up estable en fronteras como x,xx5).
  return Math.round((valor + Number.EPSILON) * factor) / factor;
};

/**
 * Deriva base e IVA del total congelado. El total no se altera: se re-normaliza a 2
 * decimales para el DTO (`1200` → `'1200.00'`).
 */
export const calcularDesgloseFacturaSenal = (
  params: CalcularDesgloseParams,
): DesgloseFacturaSenal => {
  const totalEuros = Number(params.total);
  // Céntimos enteros del total (evita el error de coma flotante en la resta del IVA).
  const totalCentimos = Math.round(totalEuros * 100);
  const baseEuros = redondearHalfUp(totalEuros / FACTOR_IVA, 2);
  const baseCentimos = Math.round(baseEuros * 100);
  const ivaCentimos = totalCentimos - baseCentimos;
  const aEuros = (centimos: number): string => (centimos / 100).toFixed(2);
  return {
    baseImponible: aEuros(baseCentimos),
    ivaPorcentaje: IVA_PORCENTAJE_MVP,
    ivaImporte: aEuros(ivaCentimos),
    total: aEuros(totalCentimos),
  };
};
