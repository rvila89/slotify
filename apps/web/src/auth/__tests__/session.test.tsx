/**
 * Fase RED — US-001 · Sesión del frontend EN MEMORIA.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Sesión del frontend en
 * memoria sin almacenamiento persistente"). tasks.md Fase 3: 3.7. REQ 10.
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe cumplir,
 * evolucionando `@/auth/session` desde el scaffolding de US-000A (que solo exponía
 * `SessionProvider`/`useSession`):
 *   - `SessionProvider` pasa a AUTOGESTIONAR el estado de sesión (en memoria).
 *   - `useSessionActions()` expone `iniciarSesion(accessToken, usuario)` y
 *     `cerrarSesion()`; `iniciarSesion` puebla la sesión SIN escribir en
 *     localStorage/sessionStorage; `cerrarSesion` la limpia.
 *
 * RED: `useSessionActions` aún no existe en `@/auth/session` → el import del símbolo
 * de producción falla y la batería está en ROJO (no por configuración del runner).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Símbolos de producción aún inexistentes (RED esperado):
import { SessionProvider, useSession, useSessionActions } from '@/auth/session';

const TOKEN = 'access.jwt.en-memoria';

// jsdom de este proyecto no provee Storage real: doble con backing store.
const crearStorageMock = (): Storage => {
  let store: Record<string, string> = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
};

const dumpStorages = () => {
  let out = '';
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k) out += `${k}=${storage.getItem(k) ?? ''};`;
    }
  }
  return out;
};

const Harness = () => {
  const session = useSession();
  const { iniciarSesion, cerrarSesion } = useSessionActions();
  return (
    <div>
      <span data-testid="estado">{session.status}</span>
      <span data-testid="usuario">{session.user?.nombre ?? ''}</span>
      <button onClick={() => iniciarSesion(TOKEN, { nombre: 'Roger' })}>iniciar</button>
      <button onClick={() => cerrarSesion()}>cerrar</button>
    </div>
  );
};

const renderHarness = () =>
  render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: crearStorageMock(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: crearStorageMock(), configurable: true });
});

describe('SessionProvider — sesión en memoria (REQ 10)', () => {
  it('debe_arrancar_como_no_autenticado', () => {
    renderHarness();
    expect(screen.getByTestId('estado')).toHaveTextContent('unauthenticated');
  });

  it('debe_poblar_la_sesion_en_memoria_al_iniciar_sesion', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(screen.getByTestId('estado')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('usuario')).toHaveTextContent('Roger');
  });

  it('no_debe_escribir_el_access_token_en_localStorage_ni_sessionStorage', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(dumpStorages()).not.toContain(TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('debe_limpiar_la_sesion_al_cerrar_sesion', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /iniciar/i }));
    await user.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.getByTestId('estado')).toHaveTextContent('unauthenticated');
  });
});
