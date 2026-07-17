import type { Factura, Presupuesto, ReservaDetalle } from '../model/types';

/** Etiqueta legible del estado terminal de la reserva del histórico. */
export const etiquetaEstadoReserva = (estado: ReservaDetalle['estado']): string =>
  estado === 'reserva_cancelada' ? 'Reserva cancelada' : 'Reserva completada';

/** Etiqueta legible del tipo de factura. */
export const etiquetaTipoFactura = (tipo?: Factura['tipo']): string => {
  const mapa: Record<string, string> = {
    senal: 'Señal',
    liquidacion: 'Liquidación',
    fianza: 'Fianza',
    complementaria: 'Complementaria',
  };
  return tipo ? (mapa[tipo] ?? tipo) : 'Factura';
};

/**
 * Presupuesto aceptado de la reserva (el congelado de la pre-reserva). Si no hay
 * ninguno `aceptado` (datos antiguos), cae al de mayor versión como aproximación
 * de presentación. Devuelve `undefined` si no hay presupuestos.
 */
export const presupuestoAceptado = (
  presupuestos?: Presupuesto[],
): Presupuesto | undefined => {
  if (!presupuestos?.length) return undefined;
  const aceptado = presupuestos.find((p) => p.estado === 'aceptado');
  if (aceptado) return aceptado;
  return [...presupuestos].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
};
