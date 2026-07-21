import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api-client';
import {
  establecerAccessTokenEnMemoria,
  obtenerAccessTokenEnMemoria,
  useSessionActions,
} from '../model/session';
import { middlewareAuthHeader } from '../api/api-middleware';
import { crearMiddlewareRefresh } from '../api/refresh-interceptor';

/**
 * Registra los middlewares del cliente HTTP generado (`apiClient.use`) sin editar
 * el cliente a mano (hook `protect-generated-client`):
 *  - `middlewareAuthHeader` adjunta el access token en memoria.
 *  - el interceptor de refresh, ante 401, intenta `POST /auth/refresh`; si renueva
 *    actualiza el token en memoria (sin navegar); si falla, cierra la sesión y
 *    redirige a `/login`.
 *
 * Debe montarse dentro de `<SessionProvider>` y de un router (consume sesión y
 * navegación). No renderiza UI.
 */
export const InterceptorRegistrar = () => {
  const { cerrarSesion } = useSessionActions();
  const navigate = useNavigate();

  useEffect(() => {
    const refrescar = async () => {
      const { data, error } = await apiClient.POST('/auth/refresh');
      if (error || !data) {
        return false;
      }
      establecerAccessTokenEnMemoria(data.accessToken);
      return true;
    };

    const onSesionExpirada = () => {
      cerrarSesion();
      navigate('/login', { replace: true });
    };

    const middlewareRefresh = crearMiddlewareRefresh({
      refrescar,
      onSesionExpirada,
      obtenerToken: obtenerAccessTokenEnMemoria,
    });
    apiClient.use(middlewareAuthHeader, middlewareRefresh);

    return () => {
      apiClient.eject(middlewareAuthHeader, middlewareRefresh);
    };
  }, [cerrarSesion, navigate]);

  return null;
};
