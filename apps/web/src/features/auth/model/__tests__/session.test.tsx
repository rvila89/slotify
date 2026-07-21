/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 2.
 *
 * Trazabilidad: spec-delta `auth` (Requirement MODIFIED "Sesión del frontend en
 * memoria…": estado transitorio `recovering`; Requirement ADDED "Recuperación de
 * sesión en recarga (F5)…"; Requirement ADDED "Aviso de expiración…": evento
 * `slotify:token-refreshed`). design.md Decisión 2 y 3. tasks.md Fase 2: 2.2.
 *
 * Contrato de producción que la fase GREEN debe cumplir:
 *   - `Session` incorpora el estado transitorio `{ status: 'recovering' }`.
 *   - `SessionProvider` SIN `value` arranca en `recovering` (mientras se intenta la
 *     rehidratación en el arranque). CON `value` inyectado se normaliza como hoy
 *     (regresión: `authenticated`/`unauthenticated`).
 *   - `establecerAccessTokenEnMemoria(token)` despacha `slotify:token-refreshed` en
 *     `window`, para que `useSessionExpiry` reprograme sus temporizadores en toda vía
 *     de renovación (login, retry del interceptor, keepSession).
 *
 * RED esperado: hoy el provider arranca `unauthenticated` sin `value` y
 * `establecerAccessTokenEnMemoria` no despacha ningún evento → las nuevas
 * aserciones fallan (assert, no error de runner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SessionProvider,
  establecerAccessTokenEnMemoria,
  useSession,
} from '@/features/auth';

const Estado = () => {
  const session = useSession();
  return <span data-testid="estado">{session.status}</span>;
};

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

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: crearStorageMock(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: crearStorageMock(), configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionProvider — estado transitorio recovering (F5 recovery)', () => {
  it('debe_arrancar_en_recovering_cuando_no_se_le_inyecta_value', () => {
    // Arrange / Act
    render(
      <SessionProvider>
        <Estado />
      </SessionProvider>,
    );

    // Assert
    expect(screen.getByTestId('estado')).toHaveTextContent('recovering');
  });

  it('debe_normalizar_a_authenticated_cuando_se_inyecta_una_sesion_autenticada', () => {
    // Regresión: la inyección de `value` (US-000A / tests) sigue funcionando.
    render(
      <SessionProvider value={{ status: 'authenticated', user: { nombre: 'Roger' } }}>
        <Estado />
      </SessionProvider>,
    );

    expect(screen.getByTestId('estado')).toHaveTextContent('authenticated');
  });

  it('debe_normalizar_a_unauthenticated_cuando_se_inyecta_un_value_no_autenticado', () => {
    // Regresión: un `value` que no representa sesión válida degrada a anónimo (no a recovering).
    render(
      <SessionProvider value={{ status: 'unauthenticated' }}>
        <Estado />
      </SessionProvider>,
    );

    expect(screen.getByTestId('estado')).toHaveTextContent('unauthenticated');
  });
});

describe('establecerAccessTokenEnMemoria — evento slotify:token-refreshed', () => {
  it('debe_despachar_el_evento_slotify_token_refreshed_al_establecer_el_token', () => {
    // Arrange
    const escucha = vi.fn();
    window.addEventListener('slotify:token-refreshed', escucha);

    // Act
    establecerAccessTokenEnMemoria('nuevo.access.token');

    // Assert
    expect(escucha).toHaveBeenCalledTimes(1);

    window.removeEventListener('slotify:token-refreshed', escucha);
  });
});
