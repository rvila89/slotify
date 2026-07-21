/**
 * Fase RED — US-000A · App Shell
 * Tasks 2.1 y 2.2: guard de ruta protegida contra la ABSTRACCION de sesion.
 *
 * Contrato de produccion que la fase GREEN (frontend-developer) debe crear:
 *  - `@/features/auth` -> `SessionProvider` ({ value }: { value: Session }) y `useSession()`.
 *    La sesion REAL la puebla US-001; aqui se INYECTA via SessionProvider (no se
 *    asume implementacion concreta de auth).
 *  - `@/features/auth` -> `RequireAuth` (componente de ruta que lee `useSession()`,
 *    deja pasar al <Outlet/> si hay sesion valida y, si no, redirige a `/login`
 *    preservando la ruta solicitada via `state.from` o `?redirect=`).
 *
 * En RED estos modulos no existen todavia: el test debe fallar por
 * "modulo/componente inexistente" (no por configuracion del runner).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
// Modulos de produccion aun inexistentes (RED esperado):
import { RequireAuth } from '@/features/auth';
import { SessionProvider, useSessionActions } from '@/features/auth';

const sesionAnonima = { status: 'unauthenticated' } as const;
const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Ada Lovelace', plan: 'Premium' },
} as const;

// Sonda en /login: revela la ruta preservada por el guard, aceptando cualquiera
// de los dos mecanismos del design (state.from o ?redirect=).
const LoginProbe = () => {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const redirect = new URLSearchParams(location.search).get('redirect');
  return (
    <div>
      <span>Pantalla de login</span>
      <span data-testid="ruta-preservada">{from ?? redirect ?? ''}</span>
    </div>
  );
};

const renderRutaProtegida = (session: unknown, initial = '/calendario') =>
  render(
    <SessionProvider value={session}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/calendario"
              element={<div>Contenido protegido: Calendario</div>}
            />
            <Route path="/reservas" element={<div>Contenido protegido: Reservas</div>} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
          {/* Outlet de cortesia para tipados; no se usa en estos casos */}
          <Route path="/_outlet" element={<Outlet />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );

describe('RequireAuth (guard de sesion)', () => {
  it('debe_redirigir_a_login_y_preservar_la_ruta_cuando_no_hay_sesion', () => {
    // Arrange / Act
    renderRutaProtegida(sesionAnonima, '/calendario');

    // Assert: no se renderiza el contenido protegido, se ve el login y la ruta
    // solicitada queda preservada para regresar tras autenticar.
    expect(screen.queryByText(/contenido protegido/i)).not.toBeInTheDocument();
    expect(screen.getByText(/pantalla de login/i)).toBeInTheDocument();
    expect(screen.getByTestId('ruta-preservada')).toHaveTextContent('/calendario');
  });

  it('debe_dar_acceso_a_la_ruta_solicitada_cuando_la_sesion_es_valida', () => {
    // Arrange / Act: sesion valida accediendo directamente a la ruta solicitada.
    renderRutaProtegida(sesionValida, '/reservas');

    // Assert: el guard deja pasar y se renderiza la ruta solicitada (sin redirigir).
    expect(screen.getByText(/contenido protegido: reservas/i)).toBeInTheDocument();
    expect(screen.queryByText(/pantalla de login/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// US-001 — el guard consume la sesión REAL poblada en memoria (no inyectada).
// Tras `iniciarSesion(...)` (provider autogestionado de US-001), la ruta
// protegida que antes redirigía a /login pasa a ser accesible sin recargar.
// RED: `useSessionActions` y el `SessionProvider` autogestionado aún no existen.
// ===========================================================================

const BotonIniciar = () => {
  const { iniciarSesion } = useSessionActions();
  return (
    <button onClick={() => iniciarSesion('access.jwt.en-memoria', { nombre: 'Roger' })}>
      iniciar sesion
    </button>
  );
};

describe('RequireAuth (guard) + sesión real US-001', () => {
  it('debe_conceder_acceso_tras_poblar_la_sesion_en_memoria_con_iniciarSesion', async () => {
    const user = userEvent.setup();
    render(
      // Se inyecta `unauthenticated` como estado inicial: sin `value`, el change
      // gestion-sesion-ux-modal-f5-error-banner hace que el provider arranque en
      // `recovering` (spinner) a la espera de `AuthBootstrap`, que no se monta en
      // este test unitario del guard. La intención del caso —el guard concede
      // acceso tras `iniciarSesion`— se preserva partiendo de anónimo.
      <SessionProvider value={{ status: 'unauthenticated' }}>
        <MemoryRouter initialEntries={['/calendario']}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route
                path="/calendario"
                element={<div>Contenido protegido: Calendario</div>}
              />
            </Route>
            <Route
              path="/login"
              element={
                <div>
                  <span>Pantalla de login</span>
                  <BotonIniciar />
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );

    // Sin sesión, el guard redirige a /login (donde está el botón de iniciar).
    expect(screen.getByText(/pantalla de login/i)).toBeInTheDocument();

    // Al poblar la sesión en memoria, el guard deja de redirigir.
    await user.click(screen.getByRole('button', { name: /iniciar sesion/i }));

    expect(await screen.findByText(/contenido protegido: calendario/i)).toBeInTheDocument();
  });
});
