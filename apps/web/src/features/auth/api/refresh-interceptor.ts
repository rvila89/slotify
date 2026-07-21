import type { Middleware } from 'openapi-fetch';

/**
 * Interceptor de refresh del cliente HTTP (US-001, REQ 10; change
 * gestion-sesion-ux-modal-f5-error-banner · Pieza 1).
 *
 * El cliente generado (`@/api-client`) NO se edita a mano (hook
 * `protect-generated-client`): este interceptor se monta como MIDDLEWARE de
 * `openapi-fetch` vía `apiClient.use(...)`.
 *
 * Comportamiento de `onResponse`:
 *  - 401 (no de `/auth/refresh`) → intenta `refrescar()`. Si resuelve `true`, la
 *    sesión se renovó (el nuevo access token ya está en memoria): se REEJECUTA la
 *    request original con el header `Authorization` renovado y se DEVUELVE la
 *    Response del reintento, de modo que openapi-fetch/TanStack Query ven un 2xx y
 *    NO se muestra banner de error. Si resuelve `false`, invoca
 *    `onSesionExpirada()` (limpiar sesión + redirigir a /login) y no reintenta.
 *  - 401 del propio `/auth/refresh` → guarda anti-recursión: no dispara refresh.
 *  - respuestas no-401 → no toca nada (devuelve `undefined`).
 */
export type OpcionesMiddlewareRefresh = {
  refrescar: () => Promise<boolean>;
  onSesionExpirada: () => void;
  /** Lee el access token EN MEMORIA (típicamente `obtenerAccessTokenEnMemoria`). */
  obtenerToken: () => string | null;
};

export const crearMiddlewareRefresh = ({
  refrescar,
  onSesionExpirada,
  obtenerToken,
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
      return undefined;
    }
    // Refresh OK: reejecuta la request original con el nuevo Authorization y
    // devuelve la Response del reintento (openapi-fetch la usa en vez del 401).
    // Se clona la request (preserva método, cuerpo, credenciales) y se sobrescribe
    // solo el header `Authorization` en el clon: evita `new Request(url,…)`, que en
    // jsdom exige una URL absoluta válida.
    const nuevoToken = obtenerToken();
    const reintento = request.clone();
    reintento.headers.set('Authorization', `Bearer ${nuevoToken ?? ''}`);
    return fetch(reintento);
  },
});
