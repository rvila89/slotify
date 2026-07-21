/**
 * Etiquetas fijas del documento traducidas por idioma (change
 * `pdf-presupuesto-horario-idioma`, Mejora 3) — helper PURO de `documentos/presentation`.
 *
 * design.md D2: las etiquetas fijas (título, cabeceras de tabla, totales, condicions) se
 * resuelven en el modelo de vista vía este helper puro, NUNCA dispersas por los `.tsx`
 * (los componentes solo pintan strings). `idioma` desconocido/ausente cae a castellano
 * (coherente con `Reserva.idioma @default("es")`). Arrow functions (ESLint `func-style`).
 */
import type { IdiomaDocumento } from './meses';

/** Bundle de rótulos fijos del documento de presupuesto ya traducidos. */
export interface EtiquetasDocumento {
  /** Título grande del documento ("PRESSUPOST"/"PRESUPUESTO"). */
  titulo: string;
  /** Rótulo de la mini-tabla de número ("Pressupost"/"Presupuesto"). */
  numeroDoc: string;
  /** Rótulo "Data"/"Fecha". */
  fecha: string;
  /** Título del bloque de cliente ("Dades client"/"Datos del cliente"). */
  datosCliente: string;
  /** Cabecera de la tabla de concepto ("CONCEPTE"/"CONCEPTO"). */
  concepto: string;
  /** Cabecera de precio ("PREU"/"PRECIO"). */
  precio: string;
  /** Palabra "persones"/"personas". */
  personas: string;
  /** Rótulo "Validesa"/"Validez". */
  validesa: string;
  /** Rótulo "Base imposable"/"Base imponible". */
  baseImponible: string;
  /** Rótulo "% Iva"/"% Iva". */
  ivaPct: string;
  /** Rótulo "Total". */
  total: string;
  /** Título del bloque de condicions ("Condicions"/"Condiciones"). */
  condiciones: string;
  /** Etiqueta del reparto anticipado ("Pagament anticipat"/"Pago anticipado"). */
  pagamentAnticipat: string;
  /** Etiqueta del importe restante ("Import restant"/"Importe restante"). */
  importRestant: string;
  /** Etiqueta de la fianza a la llegada ("A l'arribada"/"A la llegada"). */
  aLarribada: string;
  /** Rótulo "Fiança"/"Fianza". */
  fianza: string;
  /**
   * Frase de formalización del pie bancario, SIN el email (que se interpola aparte en el
   * layout): "*Per formalitzar el pagament, envieu el comprovant a"/"*Para formalizar el
   * pago, envíe el comprobante a".
   */
  formalitzarPagament: string;
  /** Frase de transferencia del pie bancario ("... al núm. de compte:"/"... de cuenta:"). */
  transferenciaCompte: string;
  /** Rótulo del bloque bancario ("Dades bancàries:"/"Datos bancarios:"). */
  dadesBancaries: string;
  /** Rótulo del importe de la factura ("Import factura"/"Importe factura"). */
  importFactura: string;
}

const ETIQUETAS_CA: EtiquetasDocumento = {
  titulo: 'PRESSUPOST',
  numeroDoc: 'Pressupost',
  fecha: 'Data',
  datosCliente: 'Dades client',
  concepto: 'CONCEPTE',
  precio: 'PREU',
  personas: 'persones',
  validesa: 'Validesa',
  baseImponible: 'Base imposable',
  ivaPct: '% Iva',
  total: 'Total',
  condiciones: 'Condicions',
  pagamentAnticipat: 'Pagament anticipat',
  importRestant: 'Import restant',
  aLarribada: "A l'arribada",
  fianza: 'Fiança',
  formalitzarPagament: '*Per formalitzar el pagament, envieu el comprovant a',
  transferenciaCompte:
    'El pagament es pot efectuar mitjançant transferència al núm. de compte:',
  dadesBancaries: 'Dades bancàries:',
  importFactura: 'Import factura',
};

const ETIQUETAS_ES: EtiquetasDocumento = {
  titulo: 'PRESUPUESTO',
  numeroDoc: 'Presupuesto',
  fecha: 'Fecha',
  datosCliente: 'Datos del cliente',
  concepto: 'CONCEPTO',
  precio: 'PRECIO',
  personas: 'personas',
  validesa: 'Validez',
  baseImponible: 'Base imponible',
  ivaPct: '% Iva',
  total: 'Total',
  condiciones: 'Condiciones',
  pagamentAnticipat: 'Pago anticipado',
  importRestant: 'Importe restante',
  aLarribada: 'A la llegada',
  fianza: 'Fianza',
  formalitzarPagament: '*Para formalizar el pago, envíe el comprobante a',
  transferenciaCompte:
    'El pago puede efectuarse mediante transferencia al núm. de cuenta:',
  dadesBancaries: 'Datos bancarios:',
  importFactura: 'Importe factura',
};

/** Devuelve las etiquetas fijas del idioma; `idioma` desconocido cae a castellano. */
export const etiquetasDocumento = (idioma: IdiomaDocumento): EtiquetasDocumento =>
  idioma === 'ca' ? ETIQUETAS_CA : ETIQUETAS_ES;
