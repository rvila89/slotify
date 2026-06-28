/**
 * Fase RED — US-000A · App Shell
 * Task 2.6: separacion de layouts auth vs app. `/login` usa el layout de
 * autenticacion y NO renderiza el chrome del shell (sidebar/header). El shell
 * SI aparece en una ruta autenticada (assert complementario para que el test no
 * sea trivialmente cierto durante RED).
 *
 * Contrato de produccion (fase GREEN):
 *  - Dos arboles de rutas independientes (design.md §1): el layout auth (`/login`)
 *    no monta `AppShell`; el layout app (protegido) si.
 *  - El boton "+ Nueva Reserva" (header del shell) es un marcador de chrome
 *    presente en toda pantalla autenticada y ausente en login.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/auth/session';

const sesionAnonima = { status: 'unauthenticated' } as const;
const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Ada Lovelace', plan: 'Premium' },
} as const;

const renderApp = (session: unknown, initial: string) =>
  render(
    <SessionProvider value={session}>
      <MemoryRouter initialEntries={[initial]}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );

describe('App Shell — separacion de layouts auth vs app', () => {
  it('login_no_renderiza_el_sidebar_ni_el_header_del_shell', () => {
    // Arrange / Act: pantalla de login (layout auth).
    renderApp(sesionAnonima, '/login');

    // Assert: se ve el formulario de login...
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();

    // ...y NO el chrome del shell: ni nav lateral ni "+ Nueva Reserva".
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText(/nueva reserva/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /calendario/i })).not.toBeInTheDocument();
  });

  it('una_ruta_autenticada_si_renderiza_el_chrome_del_shell', () => {
    // Arrange / Act: ruta autenticada (layout app).
    renderApp(sesionValida, '/calendario');

    // Assert: el shell aparece (nav lateral + "+ Nueva Reserva").
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText(/nueva reserva/i)).toBeInTheDocument();
  });
});
