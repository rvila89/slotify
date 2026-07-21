import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../model/session';
import { SessionExpiryWatcher } from './SessionExpiryWatcher';

/**
 * Guard de ruta protegida (US-000A; change
 * gestion-sesion-ux-modal-f5-error-banner · Pieza 5).
 *
 * Estados:
 *  - `recovering` → el arranque (`AuthBootstrap`) aún está rehidratando la sesión
 *    desde la cookie de refresh: se muestra un spinner centrado y NO se redirige
 *    todavía (evita el parpadeo hacia `/login` en cada F5 de un usuario logueado).
 *  - `authenticated` → deja pasar al `<Outlet/>` del layout app (AppShell) y monta
 *    el `SessionExpiryWatcher` (aviso de expiración solo bajo sesión activa).
 *  - resto (`unauthenticated`) → redirige a `/login` preservando la ruta solicitada
 *    en `state.from`, para regresar a ella tras autenticar.
 */
export const RequireAuth = () => {
  const session = useSession();
  const location = useLocation();

  if (session.status === 'recovering') {
    return (
      <div className="flex h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 aria-hidden className="size-8 animate-spin text-brand-primary" />
        <span className="sr-only">Recuperando tu sesión…</span>
      </div>
    );
  }

  if (session.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <>
      <SessionExpiryWatcher />
      <Outlet />
    </>
  );
};
