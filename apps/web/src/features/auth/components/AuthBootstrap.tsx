import { useEffect, useRef } from 'react';
import { apiClient } from '@/api-client';
import { useSession, useSessionActions, type SessionUser } from '../model/session';
import { decodificarPayloadJwt } from '../lib/jwt';

/**
 * Recuperación de sesión en recarga — F5 recovery
 * (change gestion-sesion-ux-modal-f5-error-banner · Pieza 2).
 *
 * Componente SIN UI. Al montarse intenta `POST /auth/refresh` (SDK generado):
 *  - Éxito → decodifica el payload del `accessToken` (JWT sin verificar firma) →
 *    mapea a `SessionUser` → `rehidratarSesion(token, user)` (autenticado SIN
 *    navegar: el usuario permanece en la ruta que estaba visitando).
 *  - Fallo → `cerrarSesion()` → sesión `unauthenticated`.
 *
 * Nunca escribe en `localStorage`/`sessionStorage` (REQ 10): el access token vive
 * solo en memoria y el refresh viaja en la cookie httpOnly que gestiona el
 * navegador. Debe montarse dentro de `<SessionProvider>` (junto a
 * `<InterceptorRegistrar/>`); es el que resuelve el estado transitorio
 * `recovering` con el que arranca el provider.
 */
export const AuthBootstrap = () => {
  const session = useSession();
  const { rehidratarSesion, cerrarSesion } = useSessionActions();
  // Guard de ejecución única: en StrictMode el efecto se monta dos veces en dev;
  // una sola recuperación basta y evita un segundo POST innecesario.
  const yaEjecutado = useRef(false);
  // Solo recupera cuando la sesión está SIN resolver (arranque real F5). Si el
  // provider fue sembrado con un estado concreto (`authenticated`/`unauthenticated`,
  // p. ej. en tests o SSR-hidratado), no se toca: un refresh fallido no debe tumbar
  // una sesión ya establecida.
  const debeRecuperar = session.status === 'recovering';

  useEffect(() => {
    if (yaEjecutado.current || !debeRecuperar) return;
    yaEjecutado.current = true;

    const recuperar = async () => {
      const { data, error } = await apiClient.POST('/auth/refresh', {});
      if (error || !data?.accessToken) {
        cerrarSesion();
        return;
      }
      const payload = decodificarPayloadJwt(data.accessToken);
      if (!payload) {
        cerrarSesion();
        return;
      }
      const usuario: SessionUser = {
        idUsuario: payload.idUsuario,
        email: payload.email,
        nombre: payload.nombre,
        apellidos: payload.apellidos,
        rol: payload.rol,
        plan: payload.plan,
      };
      rehidratarSesion(data.accessToken, usuario);
    };

    void recuperar();
  }, [debeRecuperar, rehidratarSesion, cerrarSesion]);

  return null;
};
