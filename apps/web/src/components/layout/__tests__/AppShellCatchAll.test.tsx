/**
 * Catch-all DENTRO del shell. Una ruta inexistente muestra "no encontrado" en el
 * area de contenido, conservando el chrome del header (disparador del menu +
 * "Nueva Reserva"). La nav vive en el drawer, accesible desde el logo.
 *
 * Contrato de produccion:
 *  - Ruta catch-all (`path="*"`) hija del layout `AppShell` que renderiza un
 *    estado "no encontrado" en el <Outlet/>, sin desmontar el header ni el
 *    disparador del drawer.
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

describe('App Shell — catch-all de ruta inexistente', () => {
  it('debe_mostrar_no_encontrado_en_el_contenido_conservando_el_chrome_y_la_nav', async () => {
    // Arrange / Act: ruta autenticada inexistente dentro del shell.
    const user = userEvent.setup();
    renderApp('/seccion-que-no-existe');

    // Assert: estado "no encontrado" en el area de contenido...
    expect(screen.getByText(/no encontrado/i)).toBeInTheDocument();

    // ...el chrome del header sigue presente (disparador del menu + "Nueva Reserva").
    expect(screen.getByRole('button', { name: /navegación/i })).toBeInTheDocument();
    expect(screen.getByText(/nueva reserva/i)).toBeInTheDocument();

    // ...y la nav (Calendario · Reservas · Métricas) sigue accesible al abrir el sidebar.
    await user.click(screen.getByRole('button', { name: /navegación/i }));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: /calendario/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /reservas/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /m[eé]tricas/i })).toBeInTheDocument();
  });
});
