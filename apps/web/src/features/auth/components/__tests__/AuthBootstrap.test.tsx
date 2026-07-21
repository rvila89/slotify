/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 2.
 *
 * Trazabilidad: spec-delta `auth` (Requirement ADDED "Recuperación de sesión en
 * recarga (F5) desde la cookie de refresh"). design.md Decisión 2. tasks.md Fase 2:
 * 2.3. REQ 10 (sin persistencia).
 *
 * Contrato de producción que la fase GREEN debe crear
 * (`components/AuthBootstrap.tsx`, exportado por `@/features/auth`):
 *   - Componente SIN UI. Al montarse, llama a `POST /auth/refresh` (SDK generado).
 *   - Éxito → decodifica el payload del `accessToken` devuelto (JWT sin verificar
 *     firma) → mapea a `SessionUser` → inicia la sesión en memoria SIN NAVEGAR
 *     (el usuario permanece en la ruta actual durante el recovery).
 *   - Fallo → deja la sesión `unauthenticated` (`cerrarSesion`).
 *   - NO persiste el token en `localStorage` ni `sessionStorage` (REQ 10).
 *   - Guard de ejecución única (StrictMode) — no verificado aquí de forma directa.
 *
 * RED esperado: `AuthBootstrap` aún no existe en `@/features/auth` → el import del
 * símbolo de producción falla y la batería está en ROJO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider, useSession } from '@/features/auth';
// Símbolo de producción aún inexistente (RED esperado):
import { AuthBootstrap } from '@/features/auth';

// SDK generado doblado: ningún test toca la red.
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

// Spy de navegación: comprobamos que el recovery NO navega.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// JWT de juguete (header.payload.signature) con base64url del payload; sin firma real.
const base64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const crearJwt = (payload: Record<string, unknown>) =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.firma-ignorada`;

const PAYLOAD = {
  idUsuario: 'u-1',
  email: 'roger@slotify.test',
  nombre: 'Roger',
  rol: 'gestor',
  exp: Math.floor(Date.now() / 1000) + 600,
};
const TOKEN = crearJwt(PAYLOAD);

const refreshOk = () => ({ data: { accessToken: TOKEN }, error: undefined, response: { status: 200 } as Response });
const refreshFallo = () => ({ data: undefined, error: { message: '401' }, response: { status: 401 } as Response });

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

const Estado = () => {
  const session = useSession();
  return (
    <div>
      <span data-testid="estado">{session.status}</span>
      <span data-testid="usuario">{session.user?.nombre ?? ''}</span>
    </div>
  );
};

const renderHarness = () =>
  render(
    <SessionProvider>
      <MemoryRouter initialEntries={['/calendario']}>
        <AuthBootstrap />
        <Estado />
      </MemoryRouter>
    </SessionProvider>,
  );

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();
  Object.defineProperty(window, 'localStorage', { value: crearStorageMock(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: crearStorageMock(), configurable: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuthBootstrap — recuperación de sesión en recarga (F5)', () => {
  it('debe_llamar_a_POST_auth_refresh_al_montarse', async () => {
    postMock.mockResolvedValue(refreshOk());

    renderHarness();

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/refresh', expect.anything()));
  });

  it('debe_iniciar_sesion_con_los_datos_del_jwt_cuando_el_refresh_es_ok', async () => {
    postMock.mockResolvedValue(refreshOk());

    renderHarness();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('usuario')).toHaveTextContent('Roger');
  });

  it('no_debe_navegar_al_rehidratar_la_sesion_en_recovery', async () => {
    postMock.mockResolvedValue(refreshOk());

    renderHarness();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('authenticated'));
    // El recovery NO saca al usuario de la ruta actual: no se navega.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('debe_dejar_la_sesion_unauthenticated_cuando_el_refresh_falla', async () => {
    postMock.mockResolvedValue(refreshFallo());

    renderHarness();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('unauthenticated'));
  });

  it('no_debe_persistir_el_token_en_localStorage_ni_sessionStorage', async () => {
    postMock.mockResolvedValue(refreshOk());

    renderHarness();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('authenticated'));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
