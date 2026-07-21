import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api-client';
import {
  EVENTO_TOKEN_REFRESCADO,
  establecerAccessTokenEnMemoria,
  obtenerAccessTokenEnMemoria,
} from '../model/session';
import { decodificarPayloadJwt } from './jwt';

/**
 * Aviso de expiración de sesión con countdown y cierre por inactividad
 * (change gestion-sesion-ux-modal-f5-error-banner · Pieza 3).
 *
 * Decodifica el `exp` (segundos epoch) del access token EN MEMORIA y programa:
 *  - aviso en `exp − 60s` → `showWarning = true` (arranca el countdown 60→0).
 *  - cierre en `exp`      → `showExpired = true` + `cerrarSesion()`.
 *
 * `keepSession()` renueva vía `POST /auth/refresh`; al establecer el nuevo token
 * en memoria se despacha `slotify:token-refreshed`, que este hook escucha para
 * REPROGRAMAR los temporizadores con el nuevo `exp` (misma vía que login o el
 * retry del interceptor). Limpia timers y listeners en el desmontaje (sin leaks).
 */
const MARGEN_AVISO_MS = 60 * 1000;

export type UseSessionExpiry = {
  showWarning: boolean;
  showExpired: boolean;
  secondsLeft: number;
  keepSession: () => Promise<void>;
};

export const useSessionExpiry = (): UseSessionExpiry => {
  const [showWarning, setShowWarning] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const timerAviso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCierre = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervaloCuenta = useRef<ReturnType<typeof setInterval> | null>(null);

  const limpiarTemporizadores = useCallback(() => {
    if (timerAviso.current) clearTimeout(timerAviso.current);
    if (timerCierre.current) clearTimeout(timerCierre.current);
    if (intervaloCuenta.current) clearInterval(intervaloCuenta.current);
    timerAviso.current = null;
    timerCierre.current = null;
    intervaloCuenta.current = null;
  }, []);

  const programar = useCallback(() => {
    limpiarTemporizadores();
    setShowWarning(false);

    const payload = decodificarPayloadJwt(obtenerAccessTokenEnMemoria());
    const expMs = payload?.exp ? payload.exp * 1000 : null;
    if (!expMs) return;

    const restanteMs = expMs - Date.now();
    const avisoEnMs = restanteMs - MARGEN_AVISO_MS;

    const dispararAviso = () => {
      setShowWarning(true);
      setSecondsLeft(60);
      intervaloCuenta.current = setInterval(() => {
        setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    };

    if (avisoEnMs <= 0) {
      dispararAviso();
    } else {
      timerAviso.current = setTimeout(dispararAviso, avisoEnMs);
    }

    timerCierre.current = setTimeout(
      () => {
        // Limpia el setInterval del countdown antes de marcar la sesión como
        // expirada; sin esto el intervalo sigue haciendo tick hasta el desmontaje.
        if (intervaloCuenta.current) clearInterval(intervaloCuenta.current);
        intervaloCuenta.current = null;
        // El cierre efectivo de la sesión (React state + token en memoria) lo
        // hace `SessionExpiryWatcher` reaccionando a `showExpired`: así el hook no
        // depende del provider y es testeable en aislamiento.
        setShowExpired(true);
      },
      Math.max(restanteMs, 0),
    );
  }, [limpiarTemporizadores]);

  // Al montar y ante cada renovación del token (login / retry / keepSession)
  // reprograma los temporizadores con el nuevo `exp`.
  useEffect(() => {
    programar();
    window.addEventListener(EVENTO_TOKEN_REFRESCADO, programar);
    return () => {
      window.removeEventListener(EVENTO_TOKEN_REFRESCADO, programar);
      limpiarTemporizadores();
    };
  }, [programar, limpiarTemporizadores]);

  const keepSession = useCallback(async () => {
    const { data, error } = await apiClient.POST('/auth/refresh', {});
    if (error || !data?.accessToken) return;
    // Despacha `slotify:token-refreshed` → `programar` corre de nuevo y cierra el
    // aviso reprogramando con el nuevo `exp`.
    establecerAccessTokenEnMemoria(data.accessToken);
    setShowWarning(false);
  }, []);

  return { showWarning, showExpired, secondsLeft, keepSession };
};
