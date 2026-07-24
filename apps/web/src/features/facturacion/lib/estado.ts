import type {
  CampoFiscalFaltante,
  EstadoFactura,
  Factura,
  TipoFactura,
} from '../model/types';

/**
 * Estado visual DERIVADO de la factura de señal para la UI (US-022 · design.md §D-9).
 * Combina `estado` del ciclo de vida con los flags derivados `esBorradorInvalido`
 * y `pdfPendiente` en una única discriminante que gobierna badge y acciones:
 *  - `enviada`: factura aprobada (`estado='enviada'` o `cobrada`); sin acciones.
 *  - `borrador-invalido`: `esBorradorInvalido=true` (faltan datos fiscales del
 *    cliente); bloquea Aprobar, no se reintenta solo (requiere acción del Gestor).
 *  - `pdf-pendiente`: `pdfPendiente=true` (fallo transitorio del PDF); bloquea
 *    Aprobar, permite Regenerar PDF; el sistema reintenta automáticamente.
 *  - `borrador`: borrador válido con PDF disponible; permite Aprobar / Rechazar.
 */
export type EstadoVisualFactura =
  | 'enviada'
  | 'borrador-invalido'
  | 'pdf-pendiente'
  | 'borrador';

/**
 * Deriva el estado visual de la factura a partir de su DTO. Acepta el tipo base
 * `Factura` (`FacturaDto`) porque solo lee `estado`/`esBorradorInvalido`/`pdfPendiente`;
 * la `FacturaSenal` (superset con `e3Enviado`) encaja igualmente.
 */
export const estadoVisualFactura = (factura: Factura): EstadoVisualFactura => {
  if (factura.estado !== 'borrador') return 'enviada';
  if (factura.esBorradorInvalido) return 'borrador-invalido';
  if (factura.pdfPendiente) return 'pdf-pendiente';
  return 'borrador';
};

/**
 * Solo un borrador válido con PDF disponible puede aprobarse. Espejo de la guarda
 * del backend (422 si datos fiscales incompletos o PDF pendiente; 409 si ya no es
 * borrador); es solo para habilitar/mostrar la acción, el servidor revalida.
 */
export const puedeAprobar = (factura: Factura): boolean =>
  estadoVisualFactura(factura) === 'borrador';

/** El rechazo solo aplica mientras la factura sigue en `borrador`. */
export const puedeRechazar = (factura: Factura): boolean =>
  factura.estado === 'borrador';

/** El PDF solo se regenera sobre un borrador (una factura emitida es inmutable). */
export const puedeRegenerarPdf = (factura: Factura): boolean =>
  factura.estado === 'borrador';

/** Etiqueta legible del estado del ciclo de vida de la factura. */
export const ETIQUETA_ESTADO_FACTURA: Record<EstadoFactura, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  cobrada: 'Cobrada',
};

/** Etiqueta legible del tipo de factura (US-022 señal, US-027 liquidación). */
export const ETIQUETA_TIPO_FACTURA: Record<TipoFactura, string> = {
  senal: 'Factura de señal',
  liquidacion: 'Factura de liquidación',
  complementaria: 'Factura complementaria',
};

/** Etiqueta legible de cada campo fiscal del CLIENTE que puede faltar. */
export const ETIQUETA_CAMPO_FISCAL: Record<CampoFiscalFaltante, string> = {
  dniNif: 'DNI / NIF',
  direccion: 'Dirección fiscal',
  codigoPostal: 'Código postal',
  poblacion: 'Población',
  provincia: 'Provincia',
};
