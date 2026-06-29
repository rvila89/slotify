/**
 * Fase RED — US-001 · Interceptor de refresh del cliente HTTP.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Sesión del frontend en
 * memoria…": "El cliente HTTP DEBE incluir un interceptor que, ante un access
 * token expirado, intente renovar vía `/auth/refresh` antes de fallar"). tasks.md
 * Fase 3: 3.7. REQ 10 (+ borde de refresh inválido del REQ 5 en el cliente).
 *
 * El cliente generado (`@/api-client`) NO se edita a mano (hook
 * `protect-generated-client`): el interceptor se monta como MIDDLEWARE de
 * `openapi-fetch` (`apiClient.use(...)`). Contrato de producción asumido que la
 * fase GREEN debe crear en `@/features/auth`:
 *   - `crearMiddlewareRefresh({ refrescar, onSesionExpirada })` → middleware con
 *     `onResponse({ response })`:
 *       · 401 → llama `refrescar()`; si resuelve `true` la sesión se renovó;
 *         si resuelve `false` invoca `onSesionExpirada()` (limpiar sesión +
 *         redirigir a /login).
 *       · respuestas no-401 → no toca nada.
 *
 * RED: el módulo `@/features/auth` aún no existe → ROJO por símbolo de
 * producción ausente (no por configuración del runner).
 */
import { describe, expect, it, vi } from 'vitest';
import { crearMiddlewareRefresh } from '@/features/auth';

const respuesta = (status: number) => ({ status }) as Response;

describe('crearMiddlewareRefresh — interceptor 401 → refresh (REQ 10)', () => {
  it('debe_intentar_refrescar_cuando_la_respuesta_es_401', async () => {
    const refrescar = vi.fn(async () => true);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, onSesionExpirada });

    await mw.onResponse?.({ response: respuesta(401) } as never);

    expect(refrescar).toHaveBeenCalledTimes(1);
  });

  it('debe_cerrar_la_sesion_cuando_el_refresh_falla', async () => {
    const refrescar = vi.fn(async () => false);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, onSesionExpirada });

    await mw.onResponse?.({ response: respuesta(401) } as never);

    expect(onSesionExpirada).toHaveBeenCalledTimes(1);
  });

  it('no_debe_intentar_refrescar_cuando_la_respuesta_es_2xx', async () => {
    const refrescar = vi.fn(async () => true);
    const onSesionExpirada = vi.fn();
    const mw = crearMiddlewareRefresh({ refrescar, onSesionExpirada });

    await mw.onResponse?.({ response: respuesta(200) } as never);

    expect(refrescar).not.toHaveBeenCalled();
    expect(onSesionExpirada).not.toHaveBeenCalled();
  });
});
