import type { Factura, TipoFactura } from '../model/types';

/**
 * Alerta al Gestor DERIVADA de la colección de facturas de la reserva (US-027 · D-6).
 * NO hay endpoint de alerta: hay "documentos pendientes de revisión" cuando existen
 * facturas en `estado='borrador'` de tipo `liquidacion` y/o `fianza`.
 *
 * El texto se adapta a qué borradores existen (design.md §D-6 / spec `facturacion`):
 *  - liquidación + fianza → "Documentos de liquidación y fianza pendientes de revisión".
 *  - solo liquidación (fianza omitida por `fianza_default_eur = 0`) → "Documentos de
 *    liquidación pendientes de revisión".
 *  - solo fianza (caso residual) → "Documentos de fianza pendientes de revisión".
 *  - ninguno → sin alerta (`null`).
 */
export type AlertaDocumentos = {
  mensaje: string;
  /** Tipos en borrador que motivan la alerta (para trazabilidad/tests). */
  tipos: TipoFactura[];
};

const esBorrador = (f: Factura): boolean => f.estado === 'borrador';

/**
 * Deriva la alerta de documentos pendientes a partir de la colección de facturas.
 * Devuelve `null` cuando no hay ningún borrador de liquidación ni de fianza.
 */
export const derivarAlertaDocumentos = (
  facturas: Factura[] | undefined,
): AlertaDocumentos | null => {
  if (!facturas || facturas.length === 0) return null;

  const hayLiquidacion = facturas.some((f) => f.tipo === 'liquidacion' && esBorrador(f));
  const hayFianza = facturas.some((f) => f.tipo === 'fianza' && esBorrador(f));

  if (!hayLiquidacion && !hayFianza) return null;

  const tipos: TipoFactura[] = [];
  if (hayLiquidacion) tipos.push('liquidacion');
  if (hayFianza) tipos.push('fianza');

  const mensaje =
    hayLiquidacion && hayFianza
      ? 'Documentos de liquidación y fianza pendientes de revisión'
      : hayLiquidacion
        ? 'Documentos de liquidación pendientes de revisión'
        : 'Documentos de fianza pendientes de revisión';

  return { mensaje, tipos };
};

/**
 * Selecciona de la colección los borradores de liquidación y fianza de US-027 en el
 * orden de visualización canónico (liquidación primero, luego fianza), excluyendo la
 * factura de señal de US-022 (que se muestra en su propia card).
 */
export const seleccionarBorradoresLiquidacionFianza = (
  facturas: Factura[] | undefined,
): Factura[] => {
  if (!facturas) return [];
  const orden: Record<string, number> = { liquidacion: 0, fianza: 1 };
  return facturas
    .filter((f) => f.tipo === 'liquidacion' || f.tipo === 'fianza')
    .sort((a, b) => (orden[a.tipo] ?? 99) - (orden[b.tipo] ?? 99));
};
