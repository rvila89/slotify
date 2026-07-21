/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
} from 'react-router-dom';

/**
 * Sesión del frontend (US-000A → US-001).
 *
 * US-000A entregó únicamente el contrato (provider + hook) y permitía INYECTAR la
 * sesión vía `value`. US-001 lo convierte en un provider AUTOGESTIONADO: la sesión
 * real vive en memoria (estado de React) y se puebla con `iniciarSesion`.
 *
 * Regla dura US-001 (REQ 10): el access token vive SOLO en memoria. NUNCA se
 * escribe en `localStorage`/`sessionStorage`. El refresh token viaja en una cookie
 * httpOnly que gestiona el navegador (no se toca desde JS).
 */
export type SessionUser = {
  idUsuario?: string;
  email?: string;
  nombre?: string;
  apellidos?: string | null;
  rol?: string;
  plan?: string;
};

export type Session =
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'unauthenticated'; user?: undefined }
  // Estado transitorio del arranque (F5 recovery): el provider intenta
  // rehidratar la sesión desde la cookie de refresh antes de decidir si el
  // usuario está autenticado o no. `RequireAuth` muestra un spinner mientras dura.
  | { status: 'recovering'; user?: undefined };

type SessionActions = {
  iniciarSesion: (accessToken: string, usuario: SessionUser) => void;
  /**
   * Rehidrata la sesión como `authenticated` SIN navegar (a diferencia de
   * `iniciarSesion`, que devuelve al usuario a `from ?? /dashboard`). La usa
   * `AuthBootstrap` en la recuperación silenciosa tras recargar (F5): el usuario
   * permanece en la ruta que estaba visitando.
   */
  rehidratarSesion: (accessToken: string, usuario: SessionUser) => void;
  cerrarSesion: () => void;
};

const SessionContext = createContext<Session>({ status: 'unauthenticated' });
const SessionSetterContext = createContext<((next: Session) => void) | null>(null);

/**
 * Token de acceso en memoria a nivel de módulo (no React) para que el middleware
 * del cliente HTTP pueda adjuntar el header `Authorization` sin acoplarse al árbol
 * de React. Es memoria volátil del runtime: se pierde al recargar y NO se persiste
 * en ningún storage (REQ 10).
 */
let accessTokenEnMemoria: string | null = null;

export const obtenerAccessTokenEnMemoria = (): string | null => accessTokenEnMemoria;

/**
 * Evento interno de la feature `auth`. Se despacha en `window` cada vez que el
 * access token en memoria se renueva (login, retry del interceptor, keepSession).
 * `useSessionExpiry` lo escucha para reprogramar sus temporizadores con el nuevo
 * `exp` sin acoplarse a quién renovó el token.
 */
export const EVENTO_TOKEN_REFRESCADO = 'slotify:token-refreshed';

/**
 * Actualiza SOLO el access token en memoria (sin tocar el estado de React ni
 * navegar). Lo usa el interceptor de refresh: ante un access expirado se renueva
 * el token silenciosamente y la sesión del usuario se mantiene intacta. Despacha
 * `slotify:token-refreshed` para que los consumidores (p. ej. el aviso de
 * expiración) reprogramen sus temporizadores con el nuevo `exp`.
 */
export const establecerAccessTokenEnMemoria = (token: string): void => {
  accessTokenEnMemoria = token;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENTO_TOKEN_REFRESCADO));
  }
};

/**
 * Normaliza un valor arbitrario a una `Session`. El provider acepta `unknown` para
 * no acoplarse a una implementación concreta de auth (US-000A lo inyectaba; los
 * tests siguen haciéndolo). Cualquier valor que no represente una sesión autenticada
 * válida se trata, de forma defensiva, como anónima.
 */
const normalizarSesion = (value: unknown): Session => {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'authenticated' &&
    Boolean((value as { user?: unknown }).user)
  ) {
    return value as Session;
  }
  return { status: 'unauthenticated' };
};

/**
 * Navegación OPCIONAL. `useSessionActions` puede invocarse fuera de un `<Router>`
 * (p. ej. en tests de la sesión pura): en ese caso no hay router y las acciones
 * solo mutan el estado en memoria. Dentro de un router, tras iniciar sesión se
 * devuelve al usuario a la ruta protegida que pidió originalmente (deep-link
 * preservado por `RequireAuth` en `state.from`), o al calendario por defecto.
 *
 * Se leen los contextos `UNSAFE_*` de React Router en vez de `useNavigate`/
 * `useLocation` porque estos lanzan si no hay router; los contextos devuelven el
 * valor por defecto (`null`) y permiten degradar con seguridad.
 */
type NavegadorOpcional = { replace: (to: string) => void } | undefined;

const useVolverTrasLogin = () => {
  const navContext = useContext(UNSAFE_NavigationContext) as {
    navigator?: NavegadorOpcional;
  } | null;
  const locContext = useContext(UNSAFE_LocationContext) as {
    location?: { state?: unknown };
  } | null;
  const navigator = navContext?.navigator;
  const location = locContext?.location;

  return useCallback(() => {
    if (!navigator) return;
    const from = (location?.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    navigator.replace(from ?? '/dashboard');
  }, [navigator, location]);
};

export const SessionProvider = ({
  value,
  children,
}: {
  value?: unknown;
  children: ReactNode;
}) => {
  // El `value` inyectado (US-000A / tests) actúa como estado INICIAL y se
  // normaliza (`authenticated`/`unauthenticated`). Sin `value` (US-001) el
  // provider arranca en `recovering`: `AuthBootstrap` intentará rehidratar la
  // sesión desde la cookie de refresh en el arranque y resolverá el estado.
  const [session, setSession] = useState<Session>(() =>
    value === undefined ? { status: 'recovering' } : normalizarSesion(value),
  );

  return (
    <SessionContext.Provider value={session}>
      <SessionSetterContext.Provider value={setSession}>
        {children}
      </SessionSetterContext.Provider>
    </SessionContext.Provider>
  );
};

export const useSession = (): Session => useContext(SessionContext);

export const useSessionActions = (): SessionActions => {
  const setSession = useContext(SessionSetterContext);
  if (!setSession) {
    throw new Error('useSessionActions debe usarse dentro de <SessionProvider>');
  }
  const volverTrasLogin = useVolverTrasLogin();

  const iniciarSesion = useCallback(
    (accessToken: string, usuario: SessionUser) => {
      establecerAccessTokenEnMemoria(accessToken);
      setSession({ status: 'authenticated', user: usuario });
      volverTrasLogin();
    },
    [setSession, volverTrasLogin],
  );

  const rehidratarSesion = useCallback(
    (accessToken: string, usuario: SessionUser) => {
      // Igual que `iniciarSesion` pero SIN navegar: el recovery (F5) es silencioso
      // y el usuario debe permanecer en la ruta que estaba visitando.
      establecerAccessTokenEnMemoria(accessToken);
      setSession({ status: 'authenticated', user: usuario });
    },
    [setSession],
  );

  const cerrarSesion = useCallback(() => {
    accessTokenEnMemoria = null;
    setSession({ status: 'unauthenticated' });
  }, [setSession]);

  return useMemo<SessionActions>(
    () => ({ iniciarSesion, rehidratarSesion, cerrarSesion }),
    [iniciarSesion, rehidratarSesion, cerrarSesion],
  );
};
