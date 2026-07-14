/**
 * Metadatos del selector de método de pago del presupuesto (6.2). El método de
 * pago que elige el Gestor determina el régimen fiscal del borrador y del
 * presupuesto confirmado (`transferencia ⇒ con_iva`, `efectivo ⇒ sin_iva`), lo
 * que fija el desglose/total y la variante del PDF. Constantes y helpers puros
 * (sin JSX): viven en `lib/` por la regla dura "components/ solo .tsx".
 */
import type { MetodoPago, RegimenIva } from '../model/types';

/** Opción del selector: valor del enum + textos en español para la UI. */
export type OpcionMetodoPago = {
  valor: MetodoPago;
  titulo: string;
  descripcion: string;
};

/**
 * Opciones del selector, en el orden en que se muestran. Los textos van en
 * español, coherentes con el resto del diálogo de presupuesto.
 */
export const OPCIONES_METODO_PAGO: readonly OpcionMetodoPago[] = [
  {
    valor: 'transferencia',
    titulo: 'Transferencia',
    descripcion: 'Presupuesto con IVA (21%).',
  },
  {
    valor: 'efectivo',
    titulo: 'Efectivo',
    descripcion: 'Presupuesto sin IVA.',
  },
] as const;

/** Método de pago por defecto del formulario (variante con IVA, como 6.1b). */
export const METODO_PAGO_POR_DEFECTO: MetodoPago = 'transferencia';

/** Etiqueta en español del régimen fiscal que devuelve el preview/confirmar. */
export const etiquetaRegimenIva = (regimen: RegimenIva): string =>
  regimen === 'con_iva' ? 'Con IVA (21%)' : 'Sin IVA';
