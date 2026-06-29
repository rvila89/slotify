/**
 * Fase RED — US-002 · Cerrar Sesión (opción "Cerrar sesión" del app shell).
 *
 * Trazabilidad: US-002, UC-02; spec-delta `auth` (Requirements AÑADIDOS "Cierre de
 * sesión desde el frontend" y "Rutas protegidas tras el logout redirigen al login").
 * tasks.md Fase 3: 3.6 (opción visible/accionable en el drawer móvil `<lg`) y 3.7
 * (ruta protegida tras logout → `/login`). REQ 6 y REQ 8.
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe cumplir:
 *   - El `SidebarContent` del `AppShell` (US-000A) ofrece una opción "Cerrar sesión"
 *     en el pie/área de usuario, ACCESIBLE y RESPONSIVE: visible y accionable también
 *     dentro del drawer móvil (`Sheet`, `<lg`).
 *   - Al activarla, llama a `POST /auth/logout` (SDK generado), limpia la sesión EN
 *     MEMORIA y redirige a `/login`; al quedar la sesión vacía, `RequireAuth` impide
 *     el acceso a cualquier ruta protegida (no expone datos).
 *
 * RED: el `SidebarContent` actual NO tiene una opción "Cerrar sesión" →
 * `getByRole('button', { name: /cerrar sesión/i })` no la encuentra y la batería
 * está en ROJO (no por configuración del runner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequireAuth } from '@/features/auth';
import { AppShell } from '@/app/AppShell';
import { SessionProvider, establecerAccessTokenEnMemoria } from '@/features/auth';

// El SDK generado se DOBLA: ningún test toca la red. El logout responde 204.
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const exito204 = () => ({ data: undefined, error: undefined, response: { status: 204 } as Response });

const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Roger', plan: 'Premium' },
} as const;

const renderApp = (initial = '/calendario') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider value={sesionValida}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/calendario" element={<div>Contenido protegido: Calendario</div>} />
                <Route path="/reservas" element={<div>Contenido protegido: Reservas</div>} />
              </Route>
            </Route>
            <Route path="/login" element={<div>Pantalla de login</div>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue(exito204());
  establecerAccessTokenEnMemoria('access.jwt.en-memoria');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell — opción "Cerrar sesión" (REQ 6)', () => {
  it('debe_ofrecer_una_opcion_de_cerrar_sesion_en_el_app_shell', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it('debe_llamar_al_endpoint_de_logout_al_pulsar_cerrar_sesion', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/logout', expect.anything()));
  });

  it('debe_redirigir_al_login_y_vaciar_la_sesion_tras_cerrar_sesion', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByText(/contenido protegido: calendario/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(await screen.findByText(/pantalla de login/i)).toBeInTheDocument();
    expect(screen.queryByText(/contenido protegido/i)).not.toBeInTheDocument();
  });
});

describe('AppShell — "Cerrar sesión" accesible en el drawer móvil (REQ 6 / responsive `<lg`)', () => {
  it('debe_exponer_la_opcion_de_cerrar_sesion_dentro_del_drawer', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /abrir navegación/i }));
    const dialog = await screen.findByRole('dialog');

    // La opción debe ser visible y accionable también en el drawer (`<lg`).
    expect(within(dialog).getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });
});

describe('AppShell — ruta protegida tras el logout (REQ 8 / 3.7)', () => {
  it('no_debe_exponer_datos_protegidos_tras_cerrar_sesion_y_debe_mostrar_el_login', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    // Sesión vacía → `RequireAuth` redirige al login sin exponer la ruta protegida.
    expect(await screen.findByText(/pantalla de login/i)).toBeInTheDocument();
    expect(screen.queryByText(/contenido protegido/i)).not.toBeInTheDocument();
  });
});
