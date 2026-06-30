/** Clases Tailwind compartidas por la página de Nueva consulta y sus secciones.
 *  Consumen tokens de `index.css`/`tailwind.config.ts` (sin hex sueltos). */
export const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500 sm:px-5';

export const claseLabel =
  'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

export const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-10';
