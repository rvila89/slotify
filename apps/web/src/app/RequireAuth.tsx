import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/auth/session';

/**
 * Guard de ruta protegida (US-000A).
 *
 * Sin sesión válida → redirige a `/login` preservando la ruta solicitada en
 * `state.from`, para que US-001 regrese a ella tras autenticar. Con sesión
 * válida → deja pasar al `<Outlet/>` del layout app (AppShell).
 */
export const RequireAuth = () => {
  const session = useSession();
  const location = useLocation();

  if (session.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};
