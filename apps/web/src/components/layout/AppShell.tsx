import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Bell, Plus } from 'lucide-react';
import { SidebarContent } from './SidebarContent';
import { resolveSectionMeta } from './navigation';
import { cn } from '@/lib/utils';

/**
 * App Shell: layout autenticado responsive (DESIGN.md §4).
 *
 * El menú lateral es un `<aside>` INTEGRADO en el layout (no un overlay/modal):
 * anima su ancho (0 ↔ 288px) empujando el contenido y se abre/cierra con el
 * logo del header. Persiste al navegar (seleccionar una sección NO lo cierra).
 * Colapsado queda `inert` + `aria-hidden` (fuera del árbol de foco y de a11y).
 *
 * El título/subtítulo del header es DINÁMICO según la ruta activa
 * (`resolveSectionMeta`). Consume design tokens vía clases Tailwind; sin hex
 * inline.
 */
const sidebarId = 'app-shell-sidebar';

export const AppShell = () => {
  const [open, setOpen] = useState(false);
  const { title, subtitle } = resolveSectionMeta(useLocation().pathname);

  return (
    <div className="flex min-h-screen bg-canvas font-body text-text-primary">
      <aside
        id={sidebarId}
        aria-hidden={!open}
        ref={(el) => {
          if (!el) return;
          if (open) el.removeAttribute('inert');
          else el.setAttribute('inert', '');
        }}
        className={cn(
          'shrink-0 overflow-hidden bg-accent-active transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
          open ? 'w-72 border-r border-border-default' : 'w-0',
        )}
      >
        <div className="h-full w-72">
          <SidebarContent />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-border-default bg-accent-active px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={open ? 'Cerrar navegación' : 'Abrir navegación'}
              aria-expanded={open}
              aria-controls={sidebarId}
              onClick={() => setOpen((valor) => !valor)}
              className="flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <img src="/slotify-icon.svg" alt="" aria-hidden="true" className="size-7" />
            </button>
            {/* Etiqueta de sección (dinámica según la ruta). NO es `<h1>`: el
                heading semántico de la página lo aporta cada page en su <Outlet/>;
                aquí sería un duplicado. */}
            <div>
              <p className="font-display text-2xl font-medium text-text-primary">{title}</p>
              <p className="font-sans text-xs text-text-secondary">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden items-center gap-2 rounded-full border border-border-default bg-surface-subtle px-3 py-1 font-sans text-xs text-text-secondary md:flex">
              <span aria-hidden className="h-2 w-2 rounded-full bg-brand-primary" />
              0 reservas hoy
            </span>
            <button
              type="button"
              aria-label="Notificaciones"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border-default bg-surface-muted text-text-secondary transition-colors hover:bg-surface-subtle"
            >
              <Bell aria-hidden className="h-5 w-5" />
            </button>
            <Link
              to="/reservas/nueva"
              aria-label="Nueva Reserva"
              className="flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2.5 font-body text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 sm:px-6"
            >
              <Plus aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva Reserva</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
