/**
 * Fase RED — US-000A · App Shell
 * Task 2.4: catch-all DENTRO del shell. Una ruta inexistente muestra
 * "no encontrado" en el area de contenido, conservando la nav y la cabecera.
 *
 * Contrato de produccion (fase GREEN):
 *  - Ruta catch-all (`path="*"`) hija del layout `AppShell` que renderiza un
 *    estado "no encontrado" en el <Outlet/>, sin desmontar la nav ni el header.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('debe_mostrar_no_encontrado_en_el_contenido_conservando_la_nav', () => {
    // Arrange / Act: ruta autenticada inexistente dentro del shell.
    renderApp('/seccion-que-no-existe');

    // Assert: estado "no encontrado" en el area de contenido...
    expect(screen.getByText(/no encontrado/i)).toBeInTheDocument();

    // ...y la nav lateral (Calendario · Reservas · Métricas) sigue visible.
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /calendario/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reservas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /m[eé]tricas/i })).toBeInTheDocument();
  });
});
