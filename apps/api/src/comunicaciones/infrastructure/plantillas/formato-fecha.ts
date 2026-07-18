/**
 * Formateo de fecha larga («19 de juliol de 2026» / «19 de julio de 2026») en los dos
 * idiomas del proyecto (catalán / castellano), reutilizado por las plantillas de email.
 *
 * Fuente ÚNICA de los nombres de mes: extraído del catálogo de plantillas (US-045) para
 * que el catálogo y el render de la transición de fecha (US-005 —
 * `email-transicion-fecha-borrador`) compartan exactamente los mismos arrays y la misma
 * lógica de composición, sin duplicar los meses.
 *
 * Se usa `getDate()`/`getMonth()`/`getFullYear()` (hora local): el llamador construye la
 * fecha del evento coherente con ese criterio (fechas de evento sin hora relevante).
 */

/** Nombres de mes en catalán, indexados por `getMonth()` (0 = gener). */
export const MESES_CA = [
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
];

/** Nombres de mes en castellano, indexados por `getMonth()` (0 = enero). */
export const MESES_ES = [
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
];

/** «19 de juliol de 2026» a partir de una `Date` (nombres de mes en catalán). */
export const formatarFechaCA = (fecha: Date): string =>
  `${fecha.getDate()} de ${MESES_CA[fecha.getMonth()]} de ${fecha.getFullYear()}`;

/** «19 de julio de 2026» a partir de una `Date` (nombres de mes en castellano). */
export const formatarFechaES = (fecha: Date): string =>
  `${fecha.getDate()} de ${MESES_ES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
