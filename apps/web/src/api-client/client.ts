/**
 * GENERADO automáticamente por scripts/generate-client.mjs (pnpm generate-client).
 * NO EDITAR A MANO. Si está desfasado, evoluciona docs/api-spec.yml y regenera.
 */
import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Cliente HTTP type-safe del frontend.
 * baseUrl: VITE_API_URL (p.ej. http://localhost:3000) + prefijo /api.
 * El JWT (access en memoria) y el tenant_id viajan en el header Authorization,
 * nunca en el path; el refresh va en cookie httpOnly (credentials: 'include').
 */
export const apiClient = createClient<paths>({
  baseUrl: `${import.meta.env.VITE_API_URL ?? ''}/api`,
  credentials: 'include',
});

export default apiClient;
