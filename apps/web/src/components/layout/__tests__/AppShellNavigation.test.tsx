/**
 * Navegacion SPA del App Shell. El menu lateral es un `<aside>` integrado que se
 * abre/cierra con el logo del header; seleccionar una seccion cambia el outlet
 * SIN recargar la pagina, resalta el item activo y NO cierra el sidebar.
 *
 * Contrato de produccion:
 *  - `@/App` cablea el arbol de rutas: layout `AppShell` protegido con nav
 *    (Dashboard · Calendario · Reservas · Métricas) en el sidebar y <Outlet/>.
 *  - El item activo se marca con `aria-current="page"` (NavLink de React Router).
 *  - `@/features/auth` -> `SessionProvider` para INYECTAR la sesion valida.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

// US-050: /reservas ya monta ReservasPage, que consume el SDK. Se DOBLA solo el
// `GET` (conservando el resto del cliente real, p. ej. `.use` del interceptor)
// para que la navegación a la sección no dispare una petición real. Devuelve una
// lista vacía → estado estable de la página.
vi.mock('@/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/api-client')>('@/api-client');
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      GET: vi.fn().mockResolvedValue({
        data: { data: [], metadata: { total: 0, page: 1, pageSize: 20 } },
        error: undefined,
        response: { status: 200 },
      }),
    },
  };
});

const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Ada Lovelace', plan: 'Premium' },
} as const;

const renderApp = (initial: string) =>
  render(
    <SessionProvider value={sesionValida}>
      <MemoryRouter initialEntries={[initial]}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );

const abrirSidebar = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /navegación/i }));
  return screen.findByRole('navigation');
};

describe('App Shell — navegacion SPA con item activo (sidebar integrado)', () => {
  it('debe_cambiar_el_outlet_sin_recargar_resaltar_el_item_activo_y_mantener_el_sidebar_abierto', async () => {
    // Arrange: en /calendario, abrimos el sidebar para acceder a la nav.
    const user = userEvent.setup();
    renderApp('/calendario');

    const nav = await abrirSidebar(user);
    const linkCalendario = within(nav).getByRole('link', { name: /calendario/i });
    const linkReservas = within(nav).getByRole('link', { name: /reservas/i });

    // Estado inicial: Calendario activo y el header muestra su subtítulo dinámico.
    expect(linkCalendario).toHaveAttribute('aria-current', 'page');
    expect(linkReservas).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/disponibilidad y bloqueos/i)).toBeInTheDocument();

    // Act: navegar a Reservas (SPA, click en el NavLink).
    await user.click(linkReservas);

    // Assert: el outlet cambia a la seccion Reservas (US-050: la ruta /reservas
    // ya renderiza la ReservasPage real). Verificamos la cabecera <h1>, que se
    // pinta con independencia del estado del query.
    expect(
      await screen.findByRole('heading', { level: 1, name: /reservas/i }),
    ).toBeInTheDocument();

    // ...el header refleja la nueva sección (subtítulo dinámico de Reservas)...
    expect(await screen.findByText(/gestión de solicitudes/i)).toBeInTheDocument();
    expect(screen.queryByText(/disponibilidad y bloqueos/i)).not.toBeInTheDocument();

    // ...el sidebar PERMANECE abierto (integrado, no modal): sin recarga, el item
    // activo pasa a Reservas y Calendario deja de estarlo.
    expect(screen.getByRole('navigation')).toBe(nav);
    expect(within(nav).getByRole('link', { name: /reservas/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: /calendario/i })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
