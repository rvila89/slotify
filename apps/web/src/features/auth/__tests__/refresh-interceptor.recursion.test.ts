/**
 * Fase RED — US-001 · Interceptor de refresh: recursión en el propio /auth/refresh.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Sesión del frontend en
 * memoria…", REQ 10 + borde de refresh inválido del REQ 5).
 *
 * BUG latente que este test expone (RED):
 *   `crearMiddlewareRefresh` intercepta TODO 401 mirando SOLO `response.status`,
 *   sin discriminar el origen de la petición. Cuando el 401 proviene del propio
 *   `/auth/refresh` (login sin cookie válida → endpoint protegido 401 → el
 *   middleware llama `/auth/refresh` → ese refresh devuelve 401 → vuelve a
 *   interceptarse), `refrescar()` se vuelve a invocar: RECURSIÓN. El error nunca
 *   se propaga a la UI.
 *
 * Comportamiento esperado (que la fase GREEN debe implementar):
 *   - Un 401 cuya `request.url` apunta a `/auth/refresh` NO debe disparar otro
 *     `refrescar()` (cortar la recursión) y debe dejar fluir el fallo
 *     (`onSesionExpirada()` para limpiar sesión + redirigir a /login).
 *
 * Diseño anti-cuelgue: `refrescar` es un mock que cuenta invocaciones. El test
 * afirma EXACTAMENTE 1 invocación total para el escenario del refresh fallido y
 * 0 invocaciones cuando el 401 viene del propio endpoint de refresh, de modo que
 * el fallo es determinista (assert), no un timeout indefinido.
 */
import { describe, expect, it, vi } from 'vitest';
import { crearMiddlewareRefresh } from '@/features/auth';

const peticion = (url: string) => ({ url }) as Request;
const respuesta = (status: number) => ({ status }) as Response;

const contexto = (url: string, status: number) =>
  ({ request: peticion(url), response: respuesta(status) }) as never;

describe('crearMiddlewareRefresh — no recursión en /auth/refresh (REQ 5/10)', () => {
  it('no_debe_reintentar_refresh_cuando_el_401_proviene_del_propio_endpoint_de_refresh', async () => {
    const refrescar = vi.fn(async () => false);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, onSesionExpirada });

    // 401 cuya petición ES el refresh: NO debe volver a llamar a refrescar().
    await mw.onResponse?.(contexto('https://api.slotify.test/auth/refresh', 401));

    expect(refrescar).not.toHaveBeenCalled();
  });

  it('debe_propagar_el_fallo_de_sesion_sin_reentrar_en_el_refresh', async () => {
    const refrescar = vi.fn(async () => false);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, onSesionExpirada });

    // Endpoint protegido devuelve 401 → se intenta UN refresh, que falla (401).
    await mw.onResponse?.(contexto('https://api.slotify.test/reservas', 401));
    // El 401 del propio refresh NO debe reentrar al middleware como nuevo intento.
    await mw.onResponse?.(contexto('https://api.slotify.test/auth/refresh', 401));

    // Exactamente un intento de refresco en todo el ciclo (sin recursión).
    expect(refrescar).toHaveBeenCalledTimes(1);
    // Y el fallo se propaga a la UI (limpiar sesión + redirigir).
    expect(onSesionExpirada).toHaveBeenCalledTimes(1);
  });
});
