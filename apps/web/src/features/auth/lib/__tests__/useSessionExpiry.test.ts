/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 3.
 *
 * Trazabilidad: spec-delta `auth` (Requirement ADDED "Aviso de expiración de sesión
 * con countdown y cierre por inactividad"). design.md Decisión 3. tasks.md Fase 2:
 * 2.4. REQ 10.
 *
 * Contrato de producción que la fase GREEN debe crear (`lib/useSessionExpiry.ts`,
 * consumido internamente por `SessionExpiryWatcher`):
 *   - `useSessionExpiry()` decodifica el campo `exp` (segundos epoch) del access
 *     token EN MEMORIA (`obtenerAccessTokenEnMemoria`, JWT sin verificar firma).
 *   - Programa dos `setTimeout`:
 *       · aviso en `(exp*1000 - now) - 60_000` → `showWarning = true`.
 *       · cierre en `(exp*1000 - now)` → `showExpired = true`.
 *   - Expone `{ showWarning, showExpired, secondsLeft, keepSession }`.
 *   - `keepSession()` renueva vía `POST /auth/refresh`, actualiza el token en memoria
 *     (que dispara `slotify:token-refreshed`) → cierra el aviso y reprograma timers.
 *   - Escucha `slotify:token-refreshed` para reprogramar con el nuevo `exp`.
 *   - Limpia timers y listeners en cleanup (sin memory leaks).
 *
 * RED esperado: `useSessionExpiry` aún no existe en el módulo → el import del símbolo
 * de producción falla y la batería está en ROJO. Fake timers para determinismo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { establecerAccessTokenEnMemoria } from '@/features/auth';
// Símbolo de producción aún inexistente (RED esperado):
import { useSessionExpiry } from '../useSessionExpiry';

// SDK generado doblado (keepSession → POST /auth/refresh).
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const base64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const crearJwtConExp = (expEpochSeg: number) =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ exp: expEpochSeg })}.firma`;

const AHORA = new Date('2026-07-21T10:00:00.000Z').getTime();
const DIEZ_MIN_MS = 10 * 60 * 1000;
const MARGEN_AVISO_MS = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  postMock.mockReset();
  // Token con exp a 10 min → aviso a los 9 min, cierre a los 10 min.
  establecerAccessTokenEnMemoria(crearJwtConExp(Math.floor((AHORA + DIEZ_MIN_MS) / 1000)));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSessionExpiry — temporizadores de aviso y cierre', () => {
  it('no_debe_mostrar_aviso_al_montar_con_un_token_lejos_de_expirar', () => {
    const { result } = renderHook(() => useSessionExpiry());

    expect(result.current.showWarning).toBe(false);
    expect(result.current.showExpired).toBe(false);
  });

  it('debe_mostrar_el_aviso_al_llegar_a_exp_menos_60s', () => {
    const { result } = renderHook(() => useSessionExpiry());

    // Avanzar hasta exp − 60s (9 min).
    act(() => {
      vi.advanceTimersByTime(DIEZ_MIN_MS - MARGEN_AVISO_MS);
    });

    expect(result.current.showWarning).toBe(true);
    expect(result.current.showExpired).toBe(false);
  });

  it('debe_mostrar_el_modal_de_expirado_al_llegar_a_exp_sin_reaccionar', () => {
    const { result } = renderHook(() => useSessionExpiry());

    act(() => {
      vi.advanceTimersByTime(DIEZ_MIN_MS);
    });

    expect(result.current.showExpired).toBe(true);
  });

  it('keepSession_debe_renovar_y_cerrar_el_aviso', async () => {
    postMock.mockResolvedValue({
      data: { accessToken: crearJwtConExp(Math.floor((AHORA + DIEZ_MIN_MS + DIEZ_MIN_MS) / 1000)) },
      error: undefined,
      response: { status: 200 } as Response,
    });
    const { result } = renderHook(() => useSessionExpiry());

    // Llegar al aviso.
    act(() => {
      vi.advanceTimersByTime(DIEZ_MIN_MS - MARGEN_AVISO_MS);
    });
    expect(result.current.showWarning).toBe(true);

    // Mantener sesión.
    await act(async () => {
      await result.current.keepSession();
    });

    expect(postMock).toHaveBeenCalledWith('/auth/refresh', expect.anything());
    // `waitFor` cuelga bajo `vi.useFakeTimers()` (testing-library detecta timers
    // por `typeof jest`, inexistente en vitest, y no avanza el reloj falso). El
    // trabajo con temporizadores ya está hecho; se pasa a timers reales solo para
    // el sondeo asíncrono, preservando la aserción (keepSession cierra el aviso), y
    // se restauran los fake timers al final para que el `afterEach` común funcione.
    vi.clearAllTimers();
    vi.useRealTimers();
    await waitFor(() => expect(result.current.showWarning).toBe(false));
    vi.useFakeTimers();
  });

  it('debe_reprogramar_los_timers_al_recibir_el_evento_slotify_token_refreshed', () => {
    const { result } = renderHook(() => useSessionExpiry());

    // El token se renueva por otra vía (login/interceptor): nuevo exp a +20 min.
    act(() => {
      establecerAccessTokenEnMemoria(crearJwtConExp(Math.floor((AHORA + 2 * DIEZ_MIN_MS) / 1000)));
    });

    // Al minuto 9 (aviso del token VIEJO) ya no debe avisar: los timers se reprogramaron.
    act(() => {
      vi.advanceTimersByTime(DIEZ_MIN_MS - MARGEN_AVISO_MS);
    });
    expect(result.current.showWarning).toBe(false);

    // El aviso llega ahora en el minuto 19 (exp nuevo − 60s).
    act(() => {
      vi.advanceTimersByTime(DIEZ_MIN_MS);
    });
    expect(result.current.showWarning).toBe(true);
  });

  it('debe_limpiar_los_timers_al_desmontar_sin_disparar_estado', () => {
    const { result, unmount } = renderHook(() => useSessionExpiry());

    unmount();

    // Tras desmontar, avanzar más allá de exp no debe re-armar nada observable
    // (sin timers pendientes que disparen efectos). No debe lanzar.
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(2 * DIEZ_MIN_MS);
      }),
    ).not.toThrow();
    // El estado capturado antes de desmontar seguía sin aviso.
    expect(result.current.showWarning).toBe(false);
  });
});
