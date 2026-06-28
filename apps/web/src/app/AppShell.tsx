import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Bell, Menu, Plus } from 'lucide-react';
import { SidebarContent } from './SidebarContent';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * App Shell (US-000A): layout autenticado responsive (DESIGN.md §4).
 *
 * - Escritorio (`≥ lg`): sidebar fijo 288px + header + content (intacto).
 * - Móvil/tablet (`< lg`): el sidebar se oculta y su contenido se sirve en un
 *   drawer off-canvas (`Sheet`, lado izquierdo) que abre el botón hamburguesa
 *   del header.
 *
 * Restricción de landmark: el drawer (Radix Dialog) se monta condicionalmente
 * (cerrado NO renderiza su contenido), de modo que en estado por defecto existe
 * un ÚNICO `<nav>` (el del aside). Consume design tokens vía clases Tailwind;
 * sin hex inline.
 */
const drawerNavId = 'app-shell-drawer';

export const AppShell = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-canvas font-body text-text-primary">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border-default bg-canvas lg:flex">
        <SidebarContent />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" id={drawerNavId} className="p-0">
          <SheetTitle className="sr-only">Navegación</SheetTitle>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-border-default bg-canvas px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Abrir navegación"
              aria-expanded={open}
              aria-controls={drawerNavId}
              onClick={() => setOpen(true)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border-default bg-surface-muted text-text-secondary transition-colors hover:bg-surface-subtle lg:hidden"
            >
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <div>
              <h1 className="font-display text-2xl font-medium text-text-primary">Panel</h1>
              <p className="font-sans text-xs text-text-secondary">Gestión de reservas</p>
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
            <button
              type="button"
              className="flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2.5 font-body text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 sm:px-6"
            >
              <Plus aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva Reserva</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
