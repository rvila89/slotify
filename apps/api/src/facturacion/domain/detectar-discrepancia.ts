/**
 * Detección de DISCREPANCIA de importe en el cobro de la liquidación — DOMINIO PURO
 * (US-029 / UC-21; spec-delta `facturacion` Requirement "Discrepancia de importe alerta pero
 * no bloquea el cobro"; design.md §D-3).
 *
 * Compara el importe realmente cobrado con el total facturado: devuelve la discrepancia
 * informativa si difieren, o `null` si coinciden. NO bloquea nada: es un valor informativo que
 * el use-case adjunta a la respuesta (`alertaDiscrepancia`) y al AUDIT_LOG.
 *
 * Ambos importes son Decimal(10,2) string (contrato `Importe`). La diferencia se calcula en
 * CÉNTIMOS enteros (nunca float) y se serializa como string de 2 decimales, siguiendo la
 * convención del contrato `AlertaDiscrepanciaCobro` (`diferencia = importeFacturado -
 * importeCobrado`). Función de flecha inmutable, sin dependencias de framework/infra.
 */

/** Parámetros de la detección de discrepancia. */
export interface ParametrosDetectarDiscrepancia {
  /** Importe realmente cobrado (Importe string). */
  importeCobrado: string;
  /** Total de la factura de liquidación (Importe string). */
  totalFactura: string;
}

/** Discrepancia informativa (importe facturado, cobrado y diferencia). */
export interface Discrepancia {
  importeFacturado: string;
  importeCobrado: string;
  diferencia: string;
}

/** Convierte un Importe string de euros a céntimos enteros (sin ruido de coma flotante). */
const aCentimos = (importe: string): number => Math.round(Number(importe) * 100);

/** Serializa céntimos enteros (posiblemente negativos) a Importe string de 2 decimales. */
const aImporte = (centimos: number): string => (centimos / 100).toFixed(2);

/**
 * Detecta la discrepancia entre lo cobrado y lo facturado. Devuelve `null` si ambos importes
 * representan el mismo valor; en caso contrario devuelve `{ importeFacturado, importeCobrado,
 * diferencia }` con la diferencia `facturado - cobrado`, todo normalizado a 2 decimales.
 */
export const detectarDiscrepancia = ({
  importeCobrado,
  totalFactura,
}: ParametrosDetectarDiscrepancia): Discrepancia | null => {
  const cobradoCentimos = aCentimos(importeCobrado);
  const facturadoCentimos = aCentimos(totalFactura);
  if (cobradoCentimos === facturadoCentimos) {
    return null;
  }
  return {
    importeFacturado: aImporte(facturadoCentimos),
    importeCobrado: aImporte(cobradoCentimos),
    diferencia: aImporte(facturadoCentimos - cobradoCentimos),
  };
};
