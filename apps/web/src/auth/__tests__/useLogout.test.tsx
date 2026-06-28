/**
 * Fase RED — US-002 · Cerrar Sesión (orquestación del logout en el frontend).
 *
 * Trazabilidad: US-002, UC-02; spec-delta `auth` (Requirements AÑADIDOS "Cierre de
 * sesión desde el frontend" y "Cierre de sesión degradado ante error de red").
 * tasks.md Fase 3: 3.6. REQ 6 (happy) y REQ 7 (degradado por red).
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe crear:
 *   - `@/auth/useLogout` → `useLogout()` que devuelve
 *     `{ cerrarSesion: () => Promise<void>; aviso: string | null; pendiente: boolean }`.
 *   - `cerrarSesion()` llama a `apiClient.POST('/auth/logout')` (SDK generado),
 *     limpia el access token + la sesión EN MEMORIA (`session.tsx`, sin storage) y
 *     redirige a `/login`.
 *   - Ante un ERROR DE RED (la llamada rechaza/no confirma): limpia IGUALMENTE la
 *     sesión de memoria, expone un `aviso` y deja al usuario sin acceso (redirige a
 *     `/login`). El refresh en cookie caducará por su TTL.
 *
 * RED: `@/auth/useLogout` aún no existe → el import del símbolo de producción falla
 * y la batería está en ROJO (no por configuración del runner).
 *
 * `useNavigate` se DOBLA con un spy para observar la redirección sin desmontar el
 * harness (y poder seguir aseverando sobre el `aviso` del cierre degradado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  SessionProvider,
  establecerAccessTokenEnMemoria,
  obtenerAccessTokenEnMemoria,
} from '@/auth/session';
// Símbolo de producción aún inexistente (RED esperado):
import { useLogout } from '@/auth/useLogout';

// El SDK generado se DOBLA: ningún test toca la red.
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

// Spy de navegación: no desmonta el harness al "redirigir".
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

const exito204 = () => ({ data: undefined, error: undefined, response: { status: 204 } as Response });

const Harness = () => {
  const { cerrarSesion, aviso } = useLogout();
  return (
    <div>
      <button onClick={() => void cerrarSesion()}>Cerrar sesión</button>
      {aviso ? <p role="alert">{aviso}</p> : null}
    </div>
  );
};

const renderHarness = () =>
  render(
    <SessionProvider value={{ status: 'authenticated', user: { nombre: 'Roger' } }}>
      <MemoryRouter initialEntries={['/calendario']}>
        <Harness />
      </MemoryRouter>
    </SessionProvider>,
  );

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();
  establecerAccessTokenEnMemoria('access.jwt.en-memoria');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useLogout — happy path (REQ 6)', () => {
  it('debe_llamar_al_SDK_de_logout_al_cerrar_sesion', async () => {
    postMock.mockResolvedValue(exito204());
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/logout', expect.anything()));
  });

  it('debe_limpiar_el_access_token_de_memoria_tras_un_logout_correcto', async () => {
    postMock.mockResolvedValue(exito204());
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(obtenerAccessTokenEnMemoria()).toBeNull());
  });

  it('debe_redirigir_al_login_tras_un_logout_correcto', async () => {
    postMock.mockResolvedValue(exito204());
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/login', expect.anything()),
    );
  });

  it('no_debe_transportar_aviso_en_el_state_de_navegacion_en_happy_path', async () => {
    postMock.mockResolvedValue(exito204());
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const [ruta, opciones] = navigateMock.mock.calls.at(-1) as [string, { state?: unknown }];
    expect(ruta).toBe('/login');
    expect((opciones?.state as { avisoLogout?: string } | undefined)?.avisoLogout).toBeUndefined();
  });
});

describe('useLogout — degradado por error de red (REQ 7)', () => {
  it('debe_limpiar_la_sesion_de_memoria_aunque_la_llamada_a_logout_falle_por_red', async () => {
    postMock.mockRejectedValue(new Error('Network request failed'));
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    // El usuario queda sin acceso efectivo en el cliente pese al fallo de red.
    await waitFor(() => expect(obtenerAccessTokenEnMemoria()).toBeNull());
  });

  it('debe_mostrar_un_aviso_de_cierre_degradado_cuando_la_red_falla', async () => {
    postMock.mockRejectedValue(new Error('Network request failed'));
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('debe_redirigir_al_login_tambien_cuando_la_red_falla', async () => {
    postMock.mockRejectedValue(new Error('Network request failed'));
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/login', expect.anything()),
    );
  });

  it('debe_transportar_el_aviso_degradado_en_el_state_de_navegacion_para_que_persista_en_login', async () => {
    postMock.mockRejectedValue(new Error('Network request failed'));
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    // El aviso NO puede depender de `SidebarContent` (se desmonta al navegar): viaja
    // en el `state` de navegación para que `LoginPage` lo muestre PERSISTENTE.
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const [ruta, opciones] = navigateMock.mock.calls.at(-1) as [string, { state?: unknown }];
    expect(ruta).toBe('/login');
    expect((opciones?.state as { avisoLogout?: string } | undefined)?.avisoLogout).toMatch(
      /sesión se ha cerrado en este dispositivo/i,
    );
  });
});
