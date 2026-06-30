import type { Middleware } from 'openapi-fetch';

/**
 * Interceptor de refresh del cliente HTTP (US-001, REQ 10).
 *
 * El cliente generado (`@/api-client`) NO se edita a mano (hook
 * `protect-generated-client`): este interceptor se monta como MIDDLEWARE de
 * `openapi-fetch` vía `apiClient.use(...)`.
 *
 * Comportamiento de `onResponse`:
 *  - 401 → intenta `refrescar()`. Si resuelve `true`, la sesión se renovó (el
 *    nuevo access token ya está en memoria). Si resuelve `false`, invoca
 *    `onSesionExpirada()` (limpiar sesión + redirigir a /login).
 *  - respuestas no-401 → no toca nada.
 */
export type OpcionesMiddlewareRefresh = {
  refrescar: () => Promise<boolean>;
  onSesionExpirada: () => void;
};

export const crearMiddlewareRefresh = ({
  refrescar,
  onSesionExpirada,
}: OpcionesMiddlewareRefresh): Middleware => ({
  onResponse: async ({ request, response }) => {
    if (response.status !== 401) {
      return undefined;
    }
    // Corta la recursión: un 401 del propio /auth/refresh NO debe reintentar
    // refrescar. Se deja fluir el fallo tal cual; la limpieza de sesión la
    // dispara el intento de refresh fallido de la petición original.
    if (request?.url?.includes('/auth/refresh')) {
      return undefined;
    }
    const renovada = await refrescar();
    if (!renovada) {
      onSesionExpirada();
    }
    return undefined;
  },
});
