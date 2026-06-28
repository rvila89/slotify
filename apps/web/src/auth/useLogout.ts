import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api-client';
import { useSessionActions } from '@/auth/session';

/**
 * Orquestación del cierre de sesión en el frontend (US-002, UC-02).
 *
 * Spec-delta `auth` (Requirements AÑADIDOS):
 *  - "Cierre de sesión desde el frontend": llama a `POST /auth/logout` (SDK
 *    generado), elimina el access token + la sesión EN MEMORIA (`session.tsx`, sin
 *    `localStorage`/`sessionStorage`) y redirige a `/login`.
 *  - "Cierre de sesión degradado ante error de red": si la llamada falla y no hay
 *    confirmación del servidor, limpia IGUALMENTE la sesión de memoria, expone un
 *    `aviso` (visible con `role="alert"` en el consumidor) y deja al usuario sin
 *    acceso efectivo (igualmente redirige a `/login`). El refresh en cookie
 *    httpOnly caducará por su TTL natural (~7 días).
 *
 * Nota de implementación: se usa un flujo `async` simple con `useState` para el
 * estado de carga en lugar de `useMutation`, porque el hook debe poder consumirse
 * fuera de un `QueryClientProvider` (limpieza de sesión + redirección son su único
 * efecto). El SDK generado NO se edita a mano (hook `protect-generated-client`).
 */
export const AVISO_DEGRADADO =
  'No se pudo confirmar el cierre en el servidor, pero tu sesión se ha cerrado en este dispositivo.';

export type UseLogout = {
  cerrarSesion: () => Promise<void>;
  aviso: string | null;
  pendiente: boolean;
};

export const useLogout = (): UseLogout => {
  const navigate = useNavigate();
  const { cerrarSesion: limpiarSesionEnMemoria } = useSessionActions();
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);

  const cerrarSesion = useCallback(async () => {
    setAviso(null);
    setPendiente(true);
    let degradado = false;
    try {
      await apiClient.POST('/auth/logout', {});
    } catch {
      // Degradado por red: no hubo confirmación del servidor. Aun así cerramos en
      // el cliente para no dejar la sesión abierta (US-002 §Edge case error de red).
      degradado = true;
    } finally {
      // Pase lo que pase, el usuario queda sin acceso efectivo en el cliente:
      // access token + sesión fuera de memoria, y de vuelta al login.
      limpiarSesionEnMemoria();
      setPendiente(false);
      if (degradado) setAviso(AVISO_DEGRADADO);
      // El aviso degradado NO puede vivir en `SidebarContent`: este se desmonta al
      // navegar a `/login`, así que el usuario nunca lo vería. Se transporta por el
      // `state` de navegación para que `LoginPage` lo rehidrate y lo muestre
      // PERSISTENTE tras la redirección. En happy path no se envía state.
      navigate('/login', {
        replace: true,
        state: degradado ? { avisoLogout: AVISO_DEGRADADO } : undefined,
      });
    }
  }, [limpiarSesionEnMemoria, navigate]);

  return { cerrarSesion, aviso, pendiente };
};
