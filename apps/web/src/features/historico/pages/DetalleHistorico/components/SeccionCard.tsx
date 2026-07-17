import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  icon: LucideIcon;
  titulo: string;
  children: ReactNode;
};

/**
 * Contenedor de sección de la ficha en modo lectura. Reutiliza el lenguaje
 * visual de la FichaConsulta (US-050): tarjeta con cabecera de icono + título en
 * versalitas. Puramente presentacional (sin acciones).
 */
export const SeccionCard = ({ icon: Icon, titulo, children }: Props) => (
  <section className="flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8">
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <Icon aria-hidden className="size-4" />
      </span>
      <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
        {titulo}
      </h2>
    </div>
    {children}
  </section>
);
