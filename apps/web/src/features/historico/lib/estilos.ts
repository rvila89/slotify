/**
 * Clases de estilo compartidas por los controles del histórico (input, select).
 * Viven en `lib/` (no en `components/`) por el guardrail del proyecto:
 * `components/` aloja SOLO `.tsx`; helpers/constantes/estilos van en `lib/`.
 */

/** Estilo base de campos de formulario (input/select) de la barra de filtros. */
export const CAMPO_CLASS =
  'w-full rounded-xl border border-border-default bg-canvas px-3 py-2 font-body text-sm text-text-primary transition-colors placeholder:text-text-muted focus-visible:border-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary';

/** Etiqueta de un campo de la barra de filtros. */
export const ETIQUETA_CLASS =
  'font-body text-xs font-semibold uppercase tracking-wide text-text-muted';
