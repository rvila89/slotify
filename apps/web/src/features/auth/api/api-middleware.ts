import type { Middleware } from 'openapi-fetch';
import { obtenerAccessTokenEnMemoria } from '../model/session';

/**
 * Middleware que adjunta el access token EN MEMORIA como `Authorization: Bearer`.
 * El token nunca se lee de storage (REQ 10): vive solo en el runtime de la SPA.
 * El refresh token viaja aparte en la cookie httpOnly (`credentials: 'include'`
 * ya configurado en el cliente generado), no se toca desde JS.
 */
export const middlewareAuthHeader: Middleware = {
  onRequest: ({ request }) => {
    const token = obtenerAccessTokenEnMemoria();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
};
