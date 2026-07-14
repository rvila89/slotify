/**
 * Clases Tailwind compartidas del diálogo de presupuesto y sus secciones co-locadas
 * (US-014). Centralizarlas evita duplicar la cadena de clases entre el diálogo, la
 * sección de datos fiscales y el campo de precio manual, y mantiene los componentes
 * por debajo del límite de 300 líneas (regla dura `max-lines`). Usa exclusivamente
 * tokens del proyecto (`index.css` + `DESIGN.md`); sin hex sueltos.
 */
export const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent-success px-8 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

export const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const claseLabel =
  'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

/** Input base (sin borde): el consumidor añade el borde/anillo según su estado. */
export const claseInputBase =
  'h-12 w-full rounded-[12px] border bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition focus-visible:ring-2 focus-visible:ring-brand-primary';

/** Input del diálogo con el borde por defecto y el resaltado de error por `aria-invalid`. */
export const claseInput = `${claseInputBase} border-border-default/30 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500`;

/**
 * Tarjeta de opción del selector de método de pago (6.2). Se renderiza como
 * `<label>` que envuelve un radio nativo (accesible). El estado seleccionado y
 * el foco del radio se reflejan con el selector `has-[:checked]` / `has-[:focus-visible]`
 * (sin JS extra). Objetivo táctil ≥ 44px (`min-h-[3.5rem]`).
 */
export const claseTarjetaMetodoPago =
  'flex min-h-[3.5rem] flex-1 cursor-pointer items-start gap-3 rounded-[12px] border border-border-default/30 bg-canvas p-4 transition hover:bg-surface-muted has-[:checked]:border-brand-primary has-[:checked]:ring-2 has-[:checked]:ring-brand-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';
