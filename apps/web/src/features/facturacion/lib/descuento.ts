/**
 * Vista previa (SOLO para mostrar) del recálculo del desglose fiscal al aplicar un
 * descuento negociado sobre el borrador de liquidación (US-028 · design.md §D-2). El
 * cálculo fiscal DEFINITIVO lo hace el backend (dominio puro `aplicarDescuentoLiquidacion`,
 * reuso del desglose de US-022); esto solo anticipa al Gestor el efecto del descuento
 * antes de confirmar, con la misma fórmula que el servidor:
 *   `total' = total − descuento`, `base = round(total'/1.21, 2)`, `iva = total' − base`.
 *
 * Los importes viajan como `Importe` (string decimal) para no perder precisión en el
 * transporte; aquí se opera en número solo para la previsualización y se re-formatea a
 * dos decimales. El resultado se muestra, nunca se envía: al backend solo va el `descuento`.
 */

/** Redondeo contable a 2 decimales (half-up), igual que el `round(x, 2)` del backend. */
const redondear2 = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

const aNumero = (importe?: string | number | null): number => {
  if (importe === null || importe === undefined || importe === '') return NaN;
  return typeof importe === 'number' ? importe : Number(importe);
};

/** Desglose previsualizado (strings decimales de 2 dígitos, como el `Importe` del contrato). */
export type DesglosePrevisto = {
  /** Total tras aplicar el descuento (`total − descuento`). */
  total: string;
  /** Base imponible = round(total'/1.21, 2). */
  baseImponible: string;
  /** IVA = total' − base (por resta, para que `base + iva = total'` exacto). */
  ivaImporte: string;
};

/**
 * Calcula la vista previa del desglose para un `totalOriginal` (Importe del borrador) y un
 * `descuento` (Importe introducido por el Gestor). Devuelve `null` si el descuento no es un
 * número válido, es negativo, o deja el total en cero/negativo (espejo del `422
 * DESCUENTO_INVALIDO` del backend; la UI deshabilita/avisa, el servidor revalida).
 */
export const calcularDesglosePrevisto = (
  totalOriginal: string | number | null | undefined,
  descuento: string | number | null | undefined,
): DesglosePrevisto | null => {
  const total = aNumero(totalOriginal);
  const desc = descuento === '' || descuento === null || descuento === undefined ? 0 : aNumero(descuento);

  if (!Number.isFinite(total) || !Number.isFinite(desc)) return null;
  if (desc < 0) return null;

  const nuevoTotal = redondear2(total - desc);
  if (nuevoTotal <= 0) return null;

  const base = redondear2(nuevoTotal / 1.21);
  const iva = redondear2(nuevoTotal - base);

  return {
    total: nuevoTotal.toFixed(2),
    baseImponible: base.toFixed(2),
    ivaImporte: iva.toFixed(2),
  };
};
