/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 1.
 *
 * Trazabilidad: spec-delta `auth` (Requirement MODIFIED "Sesión del frontend en
 * memoria…", scenario "Un 401 con refresh exitoso se resuelve sin error visible"
 * y "Un 401 con refresh fallido cierra la sesión"). design.md Decisión 1.
 * tasks.md Fase 2: 2.1. REQ 10.
 *
 * BUG que este test expone (RED):
 *   `crearMiddlewareRefresh().onResponse` devuelve SIEMPRE `undefined`, incluso tras
 *   un refresh exitoso. openapi-fetch conserva entonces la Response 401 original y
 *   TanStack Query la ve como error → banner de error visible pese al refresh OK.
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe cumplir
 * (design.md Decisión 1):
 *   - `OpcionesMiddlewareRefresh` gana un campo `obtenerToken: () => string | null`
 *     (implementado con `obtenerAccessTokenEnMemoria`).
 *   - Ante 401 (no de `/auth/refresh`): `await refrescar()`. Si `true` → clonar la
 *     `request` original, sustituir el header `Authorization` por
 *     `Bearer <obtenerToken()>`, hacer `fetch(nuevaRequest)` y DEVOLVER esa Response.
 *   - Si `refrescar()` es `false` → `onSesionExpirada()` y NO reintentar (`fetch` de
 *     retry no se llama).
 *   - Anti-recursión conservada: un 401 de `/auth/refresh` no dispara refresh.
 *   - Respuestas no-401 → no toca nada.
 *
 * RED esperado: la firma actual no acepta `obtenerToken`, no reintenta ni devuelve
 * la Response del retry → las aserciones fallan (assert, no error de runner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearMiddlewareRefresh } from '@/features/auth';

// El header Authorization se lee de una Headers real para que `.get('Authorization')`
// funcione tal como openapi-fetch construye la Request.
const crearRequest = (url: string, authInicial?: string) => {
  const headers = new Headers();
  if (authInicial) headers.set('Authorization', authInicial);
  return { url, headers, clone: () => crearRequest(url, authInicial) } as unknown as Request;
};

const crearResponse = (status: number) => ({ status } as Response);

const contexto = (url: string, status: number, authInicial?: string) =>
  ({ request: crearRequest(url, authInicial), response: crearResponse(status) }) as never;

// `fetch` global se dobla para observar el reintento y su header renovado.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crearMiddlewareRefresh — retry transparente tras 401 (REQ 10)', () => {
  it('debe_reintentar_la_peticion_con_el_nuevo_token_y_devolver_la_response_del_retry_cuando_el_refresh_es_ok', async () => {
    // Arrange
    const respuestaRetry = crearResponse(200);
    fetchMock.mockResolvedValue(respuestaRetry);
    const refrescar = vi.fn(async () => true);
    const obtenerToken = vi.fn(() => 'nuevo.access.token');
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, obtenerToken, onSesionExpirada });

    // Act
    const resultado = await mw.onResponse?.(
      contexto('https://api.slotify.test/reservas', 401, 'Bearer viejo.token'),
    );

    // Assert
    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El retry lleva el nuevo Authorization.
    const requestReintentada = fetchMock.mock.calls[0][0] as Request;
    expect(requestReintentada.headers.get('Authorization')).toBe('Bearer nuevo.access.token');
    // El middleware devuelve la Response del retry (2xx), NO el 401 original.
    expect(resultado).toBe(respuestaRetry);
    expect((resultado as Response).status).toBe(200);
    expect(onSesionExpirada).not.toHaveBeenCalled();
  });

  it('debe_cerrar_la_sesion_y_no_reintentar_cuando_el_refresh_falla', async () => {
    // Arrange
    const refrescar = vi.fn(async () => false);
    const obtenerToken = vi.fn(() => null);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, obtenerToken, onSesionExpirada });

    // Act
    await mw.onResponse?.(contexto('https://api.slotify.test/reservas', 401, 'Bearer viejo.token'));

    // Assert
    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(onSesionExpirada).toHaveBeenCalledTimes(1);
    // No se reintenta la petición: no hay token nuevo con el que reejecutar.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no_debe_disparar_refresh_cuando_el_401_proviene_del_propio_endpoint_de_refresh', async () => {
    // Arrange (guarda anti-recursión conservada)
    const refrescar = vi.fn(async () => false);
    const obtenerToken = vi.fn(() => null);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, obtenerToken, onSesionExpirada });

    // Act
    await mw.onResponse?.(contexto('https://api.slotify.test/auth/refresh', 401));

    // Assert
    expect(refrescar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no_debe_tocar_nada_cuando_la_respuesta_no_es_401', async () => {
    // Arrange
    const refrescar = vi.fn(async () => true);
    const obtenerToken = vi.fn(() => 'nuevo.access.token');
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, obtenerToken, onSesionExpirada });

    // Act
    const resultado = await mw.onResponse?.(contexto('https://api.slotify.test/reservas', 200));

    // Assert
    expect(refrescar).not.toHaveBeenCalled();
    expect(onSesionExpirada).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // Respuesta no-401: el middleware no aporta una Response (openapi-fetch conserva la suya).
    expect(resultado).toBeUndefined();
  });
});
