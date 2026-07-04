/**
 * Cálculo del TOTAL de la factura de liquidación — DOMINIO PURO (US-027 / UC-21, UC-22,
 * design.md §D-2).
 *
 *   total = importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS NULL)
 *
 * El `importe_liquidacion` ENTRA congelado de US-021 (60 % MVP = `importe_total −
 * importe_senal`): este cálculo NO recalcula el porcentaje ni la tarifa. Los `subtotal` de
 * los extras ENTRAN ya congelados por línea y FILTRADOS (`factura_id IS NULL`) por la capa de
 * lectura; aquí SÓLO se suman, nunca se recalculan cantidades ni precios.
 *
 * La suma opera en CÉNTIMOS enteros (nunca float) para no perder céntimos, y devuelve un
 * `Decimal` string de 2 decimales. El desglose fiscal del total NO se calcula aquí: se DELEGA
 * en `calcularDesgloseFacturaSenal` de US-022 (base derivada del total, IVA por resta), sin
 * duplicar lógica.
 *
 * Función de flecha inmutable, sin dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Parámetros del cálculo del total de la liquidación (Importes string). */
export interface CalcularTotalLiquidacionParams {
  /** Importe de la liquidación congelado en US-021 (60 % MVP), Decimal string. */
  importeLiquidacion: string;
  /**
   * Subtotales de los RESERVA_EXTRA pendientes (`factura_id IS NULL`), ya congelados por
   * línea y filtrados por la capa de lectura. Decimal strings.
   */
  subtotalesExtrasPendientes: ReadonlyArray<string>;
}

/** Convierte un Importe string de euros a céntimos enteros (evita el ruido de float). */
const aCentimos = (euros: string): number => Math.round(Number(euros) * 100);

/**
 * Suma el importe de liquidación congelado y los subtotales de los extras pendientes.
 * Devuelve un Decimal string de 2 decimales.
 */
export const calcularTotalLiquidacion = (
  params: CalcularTotalLiquidacionParams,
): string => {
  const totalCentimos = params.subtotalesExtrasPendientes.reduce(
    (acumulado, subtotal) => acumulado + aCentimos(subtotal),
    aCentimos(params.importeLiquidacion),
  );
  return (totalCentimos / 100).toFixed(2);
};
