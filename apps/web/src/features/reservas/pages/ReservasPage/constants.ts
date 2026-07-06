/**
 * Tokens de diseño de la pantalla de pipeline (Figma node 0:523, US-050 §Tokens
 * de diseño Figma / design.md D-7). El export de Figma viene de Stitch SIN
 * Figma Variables (`get_variable_defs` → {}), así que los hex del frame se
 * consolidan AQUÍ (no dispersos por el JSX) y se aplican vía `style`/clases
 * arbitrarias de Tailwind. La fuente de verdad de la paleta base del proyecto
 * sigue siendo `docs/DESIGN.md` + las CSS vars de `index.css`; estos son los
 * matices específicos del pipeline que aún no tienen token propio.
 */

/** Fondo de cada columna del Kanban. */
export const COLUMNA_BG = '#f6f3ee';

/** Estilos de la tarjeta del Kanban (fondo, borde, sombra) del node 0:523. */
export const TARJETA_BG = '#fcf9f4';
export const TARJETA_BORDER = 'rgba(216,194,188,0.3)';
export const TARJETA_SHADOW = '0px 12px 24px -4px rgba(125,110,100,0.08)';

/** Pista (track) común de las barras de progreso. */
export const PROGRESS_TRACK = '#eae1d6';

/** Color de relleno de cada barra de progreso. */
export const PROGRESS_LOGISTICA = '#8d4d39';
export const PROGRESS_LIQUIDACION = '#6a5c52';

/** Ancho fijo de columna del Kanban (scroll horizontal en `<lg`, D-6). */
export const COLUMNA_WIDTH_CLASS = 'w-[320px] min-w-[320px]';
