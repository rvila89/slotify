/**
 * Segmento de un texto para el destacado del término buscado (D-2: el highlight
 * es responsabilidad del frontend; el backend solo devuelve las filas que casan).
 * `match=true` marca la coincidencia (se renderiza con `<mark>`).
 */
export type SegmentoDestacado = { readonly texto: string; readonly match: boolean };

const escaparRegExp = (valor: string): string => valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Trocea `texto` en segmentos alternando coincidencias del `termino` (case-
 * insensitive, acentos literales) y el resto. Sin término (o vacío) devuelve un
 * único segmento sin match. Es una ayuda visual local sobre lo que el backend
 * full-text ya filtró; no reimplementa la búsqueda ni normaliza acentos.
 */
export const segmentosDestacados = (
  texto: string,
  termino?: string,
): SegmentoDestacado[] => {
  const aguja = termino?.trim();
  if (!aguja) return [{ texto, match: false }];

  const re = new RegExp(`(${escaparRegExp(aguja)})`, 'gi');
  const objetivo = aguja.toLowerCase();
  return texto
    .split(re)
    .filter((parte) => parte !== '')
    .map((parte) => ({ texto: parte, match: parte.toLowerCase() === objetivo }));
};
