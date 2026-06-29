/**
 * API pública del dominio de autenticación/sesión. El resto de la app importa
 * SIEMPRE desde aquí (`@/features/auth`), nunca de archivos internos.
 */
export {
  SessionProvider,
  useSession,
  useSessionActions,
  obtenerAccessTokenEnMemoria,
  establecerAccessTokenEnMemoria,
} from './model/session';
export type { Session, SessionUser } from './model/session';

export { RequireAuth } from './components/RequireAuth';
export { InterceptorRegistrar } from './components/InterceptorRegistrar';

export { useLogout, AVISO_DEGRADADO } from './api/useLogout';
export type { UseLogout } from './api/useLogout';

export { crearMiddlewareRefresh } from './api/refresh-interceptor';
export type { OpcionesMiddlewareRefresh } from './api/refresh-interceptor';
export { middlewareAuthHeader } from './api/api-middleware';
