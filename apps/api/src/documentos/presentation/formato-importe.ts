/**
 * Helper PURO de formato de importe de los documentos (change `factura-pdf-fiel-referencia`,
 * §D7) — helper de `documentos/presentation` (NO en `componentes/`, que es solo `.tsx`).
 *
 * Convierte el string decimal crudo del modelo ("178.51") al formato de importe de los
 * documentos: coma decimal y separador de millares con punto (convención es-ES/ca-ES;
 * "178,51", "1.200,00"), fiel a las referencias `F2026029` y `P2026023`.
 *
 * Formatea A PARTIR DEL STRING (split por "."), SIN `parseFloat` ni `Intl.NumberFormat`:
 * así no arrastra error de coma flotante en importes monetarios ni depende del locale
 * instalado en el entorno (determinismo, coherente con `meses.ts`). Asume 2 decimales
 * (el input viene con 2) y parte entera de cualquier longitud. Arrow function
 * (ESLint `func-style`).
 */

/** Agrupa la parte entera de derecha a izquierda en tríos separados por punto. */
const agruparMillares = (parteEntera: string): string =>
  parteEntera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Formatea un string decimal ("178.51") como importe de documento ("178,51"): millares con
 * punto, decimales con coma. Sin símbolo de moneda (lo añade el `.tsx` al interpolar " €").
 */
export const formatearImporteDocumento = (decimalString: string): string => {
  const [parteEntera, parteDecimal = ''] = decimalString.split('.');
  return `${agruparMillares(parteEntera)},${parteDecimal}`;
};
