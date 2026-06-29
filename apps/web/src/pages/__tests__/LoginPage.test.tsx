/**
 * Fase RED — US-001 · Iniciar Sesión (amplía el test de scaffolding de US-000A).
 *
 * Trazabilidad: US-001, spec-delta `auth`. tasks.md Fase 3: 3.7. Requisitos:
 *   - REQ 9: validación de formulario por campo (email/contraseña vacíos y email
 *     mal formado) SIN llamar a la API.
 *   - REQ 10: tras login OK, redirige al calendario (respetando `state.from`) y el
 *     access token NO se persiste en localStorage/sessionStorage.
 *   - REQ 3 (FA-01): credenciales inválidas → mensaje genérico, permanece en login.
 *   - REQ 8: 429 (rate-limit) → mensaje de "demasiados intentos".
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe cumplir:
 *   - `LoginPage` deja de ser un STUB: usa una MUTACIÓN TanStack Query sobre el SDK
 *     generado (`@/api-client` → `apiClient.POST('/auth/login', …)`), valida por
 *     campo antes de llamar a la API, puebla la sesión EN MEMORIA y navega al
 *     calendario (o a `state.from`).
 *
 * RED: el `LoginPage` actual es un stub (`console.info`); no llama al SDK, no valida
 * por campo ni navega → estos tests fallan por COMPORTAMIENTO DE PRODUCCIÓN AUSENTE,
 * no por configuración del runner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '@/features/auth';
import { LoginPage } from '../LoginPage';

// El SDK generado se DOBLA: ningún test toca la red. La fase GREEN hará que
// `LoginPage` invoque exactamente `apiClient.POST('/auth/login', { body })`.
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

// jsdom de este proyecto no provee Storage real: se instala un doble con backing
// store para que las aserciones de "no persistencia" sean significativas (si la
// implementación escribiera el token, el doble lo captaría).
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

const EMAIL = 'info@masialencis.com';
const PASSWORD = 'Slotify2026!';

const renderLogin = (opts?: { from?: string }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = opts?.from
    ? { pathname: '/login', state: { from: { pathname: opts.from } } }
    : '/login';
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider value={{ status: 'unauthenticated' }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/calendario" element={<div>Pantalla Calendario</div>} />
            <Route path="/reservas" element={<div>Pantalla Reservas</div>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
};

const exito = () => ({
  data: { accessToken: 'access.jwt.firmado', usuario: { idUsuario: 'u1', email: EMAIL, nombre: 'Roger', rol: 'gestor' } },
  error: undefined,
  response: { status: 200 } as Response,
});

const fallo = (status: number, message = 'Credenciales incorrectas') => ({
  data: undefined,
  error: { statusCode: status, message, error: status === 401 ? 'Unauthorized' : 'Too Many Requests' },
  response: { status } as Response,
});

beforeEach(() => {
  postMock.mockReset();
  Object.defineProperty(window, 'localStorage', { value: crearStorageMock(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: crearStorageMock(), configurable: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage — render base (US-000A, conservado)', () => {
  it('renderiza los campos email y contrasena y el boton de envio', () => {
    renderLogin();
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });
});

describe('LoginPage — validación por campo sin llamar a la API (REQ 9)', () => {
  it('debe_bloquear_el_envio_y_mostrar_error_cuando_email_y_password_estan_vacios', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /entrar/i }));

    // Validación por campo: el formulario NO llama a la API.
    expect(postMock).not.toHaveBeenCalled();
    // Y muestra mensajes de validación (copy asumido; lo fija la fase GREEN).
    expect(await screen.findByText(/(email|correo).*(obligatori|requerid)/i)).toBeInTheDocument();
    expect(await screen.findByText(/contrase.*(obligatori|requerid)/i)).toBeInTheDocument();
  });

  it('debe_bloquear_el_envio_y_mostrar_error_cuando_el_email_tiene_formato_invalido', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), 'esto-no-es-email');
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/(email|correo).*(v.lid|formato)/i)).toBeInTheDocument();
  });
});

describe('LoginPage — login correcto: mutación + redirect (REQ 10)', () => {
  it('debe_llamar_al_SDK_de_login_con_email_y_password_validos', async () => {
    postMock.mockResolvedValue(exito());
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/auth/login',
        expect.objectContaining({ body: { email: EMAIL, password: PASSWORD } }),
      ),
    );
  });

  it('debe_redirigir_al_calendario_tras_un_login_correcto', async () => {
    postMock.mockResolvedValue(exito());
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/pantalla calendario/i)).toBeInTheDocument();
  });

  it('debe_respetar_state_from_y_volver_a_la_ruta_solicitada_tras_autenticar', async () => {
    postMock.mockResolvedValue(exito());
    const user = userEvent.setup();
    renderLogin({ from: '/reservas' });

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/pantalla reservas/i)).toBeInTheDocument();
  });

  it('no_debe_persistir_el_access_token_en_localStorage_ni_sessionStorage', async () => {
    postMock.mockResolvedValue(exito());
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));
    await screen.findByText(/pantalla calendario/i);

    // Regla dura US-001: el access token vive SOLO en memoria.
    expect(dumpStorages()).not.toContain('access.jwt.firmado');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('LoginPage — aviso de cierre de sesión degradado (US-002)', () => {
  const AVISO_DEGRADADO =
    'No se pudo confirmar el cierre en el servidor, pero tu sesión se ha cerrado en este dispositivo.';

  const renderConAviso = (aviso?: string) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entry = aviso
      ? { pathname: '/login', state: { avisoLogout: aviso } }
      : '/login';
    return render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider value={{ status: 'unauthenticated' }}>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    );
  };

  it('debe_mostrar_un_banner_persistente_cuando_llega_el_aviso_en_el_state', () => {
    renderConAviso(AVISO_DEGRADADO);

    // El aviso, transportado por `useLogout` en el `state` de navegación, se muestra
    // en `/login` (donde `SidebarContent` ya no existe) de forma accesible.
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/sesión se ha cerrado en este dispositivo/i);
  });

  it('no_debe_mostrar_el_banner_cuando_no_hay_aviso_en_el_state', () => {
    renderConAviso();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('LoginPage — errores de la API (REQ 3 / REQ 8)', () => {
  it('debe_mostrar_un_mensaje_generico_y_permanecer_en_login_ante_credenciales_invalidas', async () => {
    postMock.mockResolvedValue(fallo(401));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), 'mala');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    // El copy del diseño (subtítulo "Introduce tus credenciales…") también contiene
    // la palabra, así que afianzamos la aserción al contenedor de error role="alert"
    // (anti-enumeration, REQ 3 / FA-01): más estricta, no más débil.
    expect(await screen.findByRole('alert')).toHaveTextContent(/credenciales/i);
    expect(screen.queryByText(/pantalla calendario/i)).not.toBeInTheDocument();
  });

  it('debe_avisar_de_demasiados_intentos_cuando_la_API_responde_429', async () => {
    postMock.mockResolvedValue(fallo(429, 'Too Many Requests'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/correo/i), EMAIL);
    await user.type(screen.getByLabelText(/contraseña/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/(demasiad|intent|espera)/i)).toBeInTheDocument();
  });
});
