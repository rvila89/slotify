/**
 * Clases de estilo compartidas de la sección de documentación del evento (US-033).
 * Viven en `lib/` (no en `components/`) por la regla dura del proyecto: los
 * `.tsx` de `components/` alojan SOLO componentes React; helpers, constantes y
 * clases de estilo van en `lib/`. Usan los tokens del proyecto (`index.css` +
 * `DESIGN.md`), sin hex hardcodeado.
 */

export const CLASE_SECCION =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/** Botón primario de subida: `w-full` en móvil, `sm:w-auto`; alto táctil ≥ 48px. */
export const CLASE_BOTON_SUBIR =
  'inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

/** Botón secundario (re-subir un tipo ya completado). */
export const CLASE_BOTON_RESUBIR =
  'inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';
