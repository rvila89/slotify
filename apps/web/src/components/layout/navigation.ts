import {
  Archive,
  BarChart3,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navegación del App Shell: única fuente de verdad de las secciones del MVP.
 *
 * Cada entrada declara su `to` (ruta), su `label`/`icon` (item del menú lateral)
 * y su `title`/`subtitle` (cabecera dinámica del header). Se consume tanto en el
 * `SidebarContent` (links del drawer) como en el `AppShell` (título de cabecera
 * según la ruta activa), evitando duplicar el listado.
 */
export type NavItem = {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
};

export const navItems: readonly NavItem[] = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Vista general de la operación',
  },
  {
    to: '/calendario',
    label: 'Calendario',
    icon: CalendarDays,
    title: 'Calendario',
    subtitle: 'Disponibilidad y bloqueos',
  },
  {
    to: '/reservas',
    label: 'Reservas',
    icon: ClipboardList,
    title: 'Reservas',
    subtitle: 'Gestión de solicitudes',
  },
  {
    to: '/historico',
    label: 'Histórico',
    icon: Archive,
    title: 'Histórico',
    subtitle: 'Reservas completadas y canceladas',
  },
  {
    to: '/metricas',
    label: 'Métricas',
    icon: BarChart3,
    title: 'Métricas',
    subtitle: 'Indicadores del negocio',
  },
] as const;

export type SectionMeta = { readonly title: string; readonly subtitle: string };

const META_POR_DEFECTO: SectionMeta = { title: 'Panel', subtitle: 'Gestión de reservas' };

/**
 * Resuelve el título/subtítulo de cabecera para una ruta. Usa match por prefijo
 * más largo, de modo que las sub-rutas (p. ej. `/reservas/nueva`, `/reservas/:id`)
 * heredan la meta de su sección padre (`/reservas`). Cae al valor por defecto
 * para rutas fuera del menú (catch-all, etc.).
 */
export const resolveSectionMeta = (pathname: string): SectionMeta => {
  const match = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));

  return match ? { title: match.title, subtitle: match.subtitle } : META_POR_DEFECTO;
};
