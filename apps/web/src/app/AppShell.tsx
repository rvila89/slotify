import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, ClipboardList, Plus } from 'lucide-react';
import { useSession } from '@/auth/session';
import { cn } from '@/lib/utils';

/**
 * App Shell (US-000A): layout autenticado de dos columnas (DESIGN.md §4).
 * Sidebar 288px (marca + nav Calendario·Reservas·Métricas + card usuario) +
 * header (título/subtítulo, badge, campana, "+ Nueva Reserva") + content outlet.
 * Consume design tokens vía clases Tailwind; sin hex inline.
 */
const navItems = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/reservas', label: 'Reservas', icon: ClipboardList },
  { to: '/metricas', label: 'Métricas', icon: BarChart3 },
] as const;

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-full px-4 py-3 font-sans text-sm font-semibold tracking-wide transition-colors',
    isActive
      ? 'bg-accent-active text-text-muted'
      : 'text-text-secondary hover:bg-surface-muted',
  );

const inicialDe = (nombre?: string) => (nombre?.trim()?.[0] ?? '·').toUpperCase();

export const AppShell = () => {
  const session = useSession();
  const user = session.status === 'authenticated' ? session.user : undefined;

  return (
    <div className="flex min-h-screen bg-canvas font-body text-text-primary">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border-default bg-canvas">
        <div className="p-8">
          <span className="font-display text-3xl font-bold tracking-tight text-brand-primary">
            Slotify
          </span>
        </div>

        <nav aria-label="Navegación principal" className="flex flex-1 flex-col gap-2 px-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClasses}>
              <Icon aria-hidden className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-6">
          <div className="flex items-center gap-3 rounded-md border border-border-default bg-surface-muted p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-state-confirmada font-sans text-sm font-semibold text-brand-foreground">
              {inicialDe(user?.nombre)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-sans text-sm font-semibold text-text-primary">
                {user?.nombre ?? 'Invitado'}
              </p>
              {user?.plan ? (
                <p className="font-sans text-[10px] uppercase tracking-wider text-text-secondary">
                  {user.plan} Plan
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-border-default bg-canvas px-8">
          <div>
            <h1 className="font-display text-2xl font-medium text-text-primary">Panel</h1>
            <p className="font-sans text-xs text-text-secondary">Gestión de reservas</p>
          </div>

          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 rounded-full border border-border-default bg-surface-subtle px-3 py-1 font-sans text-xs text-text-secondary">
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
              className="flex items-center gap-2 rounded-full bg-brand-primary px-6 py-2.5 font-body text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
            >
              <Plus aria-hidden className="h-4 w-4" />
              Nueva Reserva
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
