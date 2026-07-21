import { useNavigate } from 'react-router-dom';
import { useSessionActions } from '../model/session';
import { useSessionExpiry } from '../lib/useSessionExpiry';
import { SessionExpiryWarningModal } from './SessionExpiryWarningModal';
import { SessionExpiredModal } from './SessionExpiredModal';

/**
 * Orquestador del aviso de expiración de sesión
 * (change gestion-sesion-ux-modal-f5-error-banner · Pieza 5).
 *
 * Conecta `useSessionExpiry` (temporizadores + countdown) con los dos modales
 * forzados. Se monta SOLO bajo sesión autenticada (lo hace `RequireAuth`), de modo
 * que sus temporizadores no corren en pantallas públicas. No renderiza chrome
 * propio: solo los modales, que aparecen según el estado del hook.
 */
export const SessionExpiryWatcher = () => {
  const { showWarning, showExpired, secondsLeft, keepSession } = useSessionExpiry();
  const { cerrarSesion } = useSessionActions();
  const navigate = useNavigate();

  const handleLogout = () => {
    cerrarSesion();
    navigate('/login', { replace: true });
  };

  // Al llegar a `exp` el hook muestra el modal de sesión cerrada (bloqueante). El
  // cierre efectivo de la sesión ocurre aquí, al pulsar "Iniciar sesión": se limpia
  // el token/estado en memoria y se navega a `/login`. No se cierra antes para que
  // `RequireAuth` no desmonte este watcher (ni su modal) por el cambio de estado.
  const handleLogin = () => {
    cerrarSesion();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <SessionExpiryWarningModal
        open={showWarning}
        secondsLeft={secondsLeft}
        onKeepSession={keepSession}
        onLogout={handleLogout}
      />
      <SessionExpiredModal open={showExpired} onLogin={handleLogin} />
    </>
  );
};
