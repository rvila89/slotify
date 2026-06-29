/** Cabecera numerada de una sección del formulario de alta. */
export const SeccionHeader = ({ numero, titulo }: { numero: number; titulo: string }) => (
  <div className="flex items-center gap-4">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 font-body text-base font-bold text-brand-primary">
      {numero}
    </span>
    <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
      {titulo}
    </h2>
  </div>
);
