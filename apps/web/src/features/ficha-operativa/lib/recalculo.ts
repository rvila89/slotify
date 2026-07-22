import type { RecalculoResultado } from '../model/types';

/** Formatea un `Importe` (string decimal del contrato) o número a euros en español. */
export const formatearEuros = (importe?: string | number | null): string => {
  if (importe === null || importe === undefined || importe === '') return '—';
  const valor = typeof importe === 'number' ? importe : Number(importe);
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * Mensaje del aviso de recálculo cuando el motor SÍ resolvió tarifa
 * (`tarifaAConsultar=false`) y hay `nuevoTotal`. Ej.:
 * "Precio actualizado a 1.210,00 €. Pendiente de pago: 605,00 €."
 */
export const mensajeRecalculo = (recalculo: RecalculoResultado): string => {
  const total = formatearEuros(recalculo.nuevoTotal);
  const restante = formatearEuros(recalculo.liquidacionRestante);
  return `Precio actualizado a ${total}. Pendiente de pago: ${restante}.`;
};

/**
 * `true` si el recálculo requiere que el gestor introduzca un precio manual
 * (`tarifaAConsultar=true`, tramo +51 o sin TARIFA configurada). En ese caso el
 * formulario debe mostrar el input `precioManualEur` y reenviarse.
 */
export const requierePrecioManual = (
  recalculo?: RecalculoResultado | null,
): boolean => recalculo?.tarifaAConsultar === true;
