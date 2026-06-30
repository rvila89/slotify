/**
 * Fase RED — US-000A · App Shell
 * Task 2.3: navegacion SPA. Seleccionar una seccion de la nav lateral cambia el
 * outlet SIN recargar la pagina y resalta el item activo.
 *
 * Contrato de produccion (fase GREEN):
 *  - `@/App` (ya existe) debe cablear el arbol de rutas: layout `AppShell`
 *    protegido con nav lateral (Calendario · Reservas · Métricas) y <Outlet/>.
 *  - El item activo se marca con `aria-current="page"` (NavLink de React Router).
 *  - Cada seccion no construida renderiza un placeholder con `data-testid=
 *    "section-placeholder"` que incluye el nombre de la seccion (ver task 2.5).
 *  - `@/features/auth` -> `SessionProvider` para INYECTAR la sesion valida.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

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

describe('App Shell — navegacion SPA con item activo', () => {
  it('debe_cambiar_el_outlet_sin_recargar_y_resaltar_el_item_activo_al_seleccionar_seccion', async () => {
    // Arrange
    const user = userEvent.setup();
    renderApp('/calendario');

    const nav = screen.getByRole('navigation');
    const linkCalendario = within(nav).getByRole('link', { name: /calendario/i });
    const linkReservas = within(nav).getByRole('link', { name: /reservas/i });

    // Estado inicial: Calendario activo.
    expect(linkCalendario).toHaveAttribute('aria-current', 'page');
    expect(linkReservas).not.toHaveAttribute('aria-current', 'page');

    // Act: navegar a Reservas (SPA, click en el NavLink).
    await user.click(linkReservas);

    // Assert: el outlet cambia a la seccion Reservas...
    const outlet = await screen.findByTestId('section-placeholder');
    expect(within(outlet).getByText(/reservas/i)).toBeInTheDocument();

    // ...el item activo pasa a Reservas y Calendario deja de estarlo...
    expect(linkReservas).toHaveAttribute('aria-current', 'page');
    expect(linkCalendario).not.toHaveAttribute('aria-current', 'page');

    // ...y la nav lateral sigue siendo la misma (sin recarga de documento).
    expect(screen.getByRole('navigation')).toBe(nav);
  });
});
