/**
 * Descuento negociado sobre la factura de liquidación — DOMINIO PURO (US-028 / UC-21,
 * design.md §D-2).
 *
 * El Gestor aplica MANUALMENTE un descuento sobre el total del borrador mientras está en
 * `borrador`: `total_nuevo = total − descuento`. El desglose fiscal se DELEGA en
 * `calcularDesgloseFacturaSenal` de US-022 (`base = round(total/1,21, 2)`, `iva = total −
 * base`, `iva_porcentaje = 21,00`, `base + iva = total` EXACTO); NO se duplica lógica de
 * IVA ni se recalcula tarifa/porcentaje.
 *
 * Opera con CÉNTIMOS enteros (nunca aritmética float) para que la resta sea exacta. Guardas
 * de dominio: el descuento no puede ser negativo ni dejar el total en cero/negativo.
 *
 * Función de flecha inmutable, sin dependencias de framework/infra (hook `no-infra-in-domain`).
 */
import {
  calcularDesgloseFacturaSenal,
  type DesgloseFacturaSenal,
} from './calculo-factura';

/** Borrador mínimo sobre el que se aplica el descuento (solo el total importa). */
export interface BorradorLiquidacion {
  /** Total actual del borrador (Importe string de 2 decimales). */
  total: string;
}

/**
 * Error de DOMINIO: descuento inválido (negativo o que deja el total en cero/negativo).
 * La aplicación lo mapea a HTTP 422 (`DESCUENTO_INVALIDO`).
 */
export class DescuentoInvalidoError extends Error {
  readonly codigo = 'DESCUENTO_INVALIDO' as const;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'DescuentoInvalidoError';
  }
}

/** Convierte un Importe string de euros a céntimos enteros (sin ruido de coma flotante). */
const aCentimos = (importe: string): number => Math.round(Number(importe) * 100);

/**
 * Aplica el descuento negociado al total del borrador y recalcula el desglose fiscal
 * (reutilizando el de US-022). Devuelve el desglose completo con el nuevo total.
 */
export const aplicarDescuentoLiquidacion = (
  borrador: BorradorLiquidacion,
  descuento: string,
): DesgloseFacturaSenal => {
  const descuentoCentimos = aCentimos(descuento);
  if (descuentoCentimos < 0) {
    throw new DescuentoInvalidoError('El descuento no puede ser negativo');
  }
  const totalCentimos = aCentimos(borrador.total);
  const nuevoTotalCentimos = totalCentimos - descuentoCentimos;
  if (nuevoTotalCentimos <= 0) {
    throw new DescuentoInvalidoError(
      'El descuento no puede dejar el total en cero o negativo',
    );
  }
  const nuevoTotal = (nuevoTotalCentimos / 100).toFixed(2);
  return calcularDesgloseFacturaSenal({ total: nuevoTotal });
};
