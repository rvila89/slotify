/**
 * Nombres de mes por idioma + formateo de fecha larga determinista (change
 * `pdf-presupuesto-horario-idioma`, Mejora 1) — helper PURO de `documentos/presentation`.
 *
 * design.md D2: mapa estático `MESES = { ca, es }`; NUNCA `Intl.DateTimeFormat` (depende
 * del locale instalado en el entorno y rompe el determinismo de los unit tests). El
 * formateo usa `getUTCDate/getUTCMonth/getUTCFullYear` para no desplazar el día en zonas
 * horarias negativas a medianoche UTC. Arrow functions (ESLint `func-style`).
 */

/** Idioma del documento (es por defecto). */
export type IdiomaDocumento = 'es' | 'ca';

/** Mapa estático de nombres de mes por idioma (índice 0 = enero/gener). */
export const MESES: { ca: readonly string[]; es: readonly string[] } = {
  ca: [
    'gener',
    'febrer',
    'març',
    'abril',
    'maig',
    'juny',
    'juliol',
    'agost',
    'setembre',
    'octubre',
    'novembre',
    'desembre',
  ],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
};

/**
 * Formatea una fecha como "D de <mes> de AAAA" (día sin cero-padding, en UTC, mes por
 * idioma). Determinista: independiente del locale y la zona horaria del entorno.
 */
export const formatearFechaLarga = (fecha: Date, idioma: IdiomaDocumento): string => {
  const meses = idioma === 'ca' ? MESES.ca : MESES.es;
  const dia = fecha.getUTCDate();
  const mes = meses[fecha.getUTCMonth()];
  const anio = fecha.getUTCFullYear();
  return `${dia} de ${mes} de ${anio}`;
};
