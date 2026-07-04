import { NavLink } from 'react-router-dom';
import { BarChart3, CalendarDays, ClipboardList, LogOut } from 'lucide-react';
import { useLogout, useSession } from '@/features/auth';
import { cn } from '@/lib/utils';

/**
 * Contenido del sidebar del App Shell (US-000A): marca "Slotify",
 * navegación principal (Calendario · Reservas · Métricas) y card de usuario.
 *
 * Se reutiliza en dos contenedores:
 *  - el `<aside>` fijo de escritorio (`≥ lg`), y
 *  - el drawer off-canvas (`Sheet`) en móvil/tablet (`< lg`).
 *
 * `onNavigate` permite al contenedor reaccionar al click de un NavLink (en el
 * drawer cierra el panel). Mantiene los tokens del diseño (bg-canvas,
 * border-border-default, bg-accent-active, bg-state-confirmada, …).
 */
const navItems = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/reservas', label: 'Reservas', icon: ClipboardList },
  { to: '/metricas', label: 'Métricas', icon: BarChart3 },
] as const;

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-full px-4 py-3 font-sans text-sm font-semibold tracking-wide transition-colors',
    isActive ? 'bg-accent-active text-text-muted' : 'text-text-secondary hover:bg-surface-muted',
  );

const inicialDe = (nombre?: string) => (nombre?.trim()?.[0] ?? '·').toUpperCase();

export const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const session = useSession();
  const user = session.status === 'authenticated' ? session.user : undefined;
  const { cerrarSesion, aviso, pendiente } = useLogout();

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 p-8">
        <img src="/slotify-icon.svg" alt="" aria-hidden="true" className="size-7" />
        <span className="font-display text-3xl font-bold tracking-tight text-brand-primary">
          Slotify
        </span>
      </div>

      <nav aria-label="Navegación principal" className="flex flex-1 flex-col gap-2 px-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={navLinkClasses} onClick={onNavigate}>
            <Icon aria-hidden className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-3 p-6">
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

        {aviso ? (
          <p
            role="alert"
            className="rounded-md border border-border-default bg-surface-muted px-3 py-2 font-sans text-xs text-text-secondary"
          >
            {aviso}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void cerrarSesion()}
          disabled={pendiente}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-3 font-sans text-sm font-semibold tracking-wide text-text-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut aria-hidden className="h-5 w-5" />
          <span>{pendiente ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
        </button>
      </div>
    </div>
  );
};
