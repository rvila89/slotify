/**
 * Tablas de datos declarativas del dominio de comunicaciones (US-046 · UC-36):
 * etiqueta + clases de estilo del badge de estado y etiquetas legibles del
 * `codigoEmail`. Viven en `lib/` (no en `components/`) por la regla dura del proyecto
 * (`components/` solo aloja `.tsx`). El servidor es la fuente de verdad del estado;
 * estas tablas solo lo presentan.
 */
import type { CodigoEmail, EstadoComunicacion } from '../model/types';

/** Presentación (etiqueta + clases de badge) de cada estado de la COMUNICACION. */
export const ESTADO_COMUNICACION: Record<
  EstadoComunicacion,
  { etiqueta: string; clase: string }
> = {
  borrador: {
    etiqueta: 'Borrador',
    clase: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  enviado: {
    etiqueta: 'Enviado',
    clase: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  fallido: {
    etiqueta: 'Fallido',
    clase: 'border-red-200 bg-red-50 text-red-700',
  },
};

/** Etiquetas legibles del `codigoEmail`. Los E1..E8 son emails del ciclo de vida. */
const CODIGO_EMAIL_LABEL: Record<CodigoEmail, string> = {
  E1: 'Confirmación de consulta (E1)',
  E2: 'Recordatorio (E2)',
  E3: 'Factura de señal (E3)',
  E4: 'Recordatorio de evento (E4)',
  E5: 'Cierre de evento (E5)',
  E6: 'Liquidación (E6)',
  E7: 'Devolución de fianza (E7)',
  E8: 'Comunicación (E8)',
  E10: 'Fianza devuelta (E10)',
  manual: 'Email manual',
};

/** Devuelve la etiqueta legible de un `codigoEmail`, con reserva por si aparece uno nuevo. */
export const etiquetaCodigoEmail = (codigo: CodigoEmail): string =>
  CODIGO_EMAIL_LABEL[codigo] ?? codigo;
