import { LockKeyhole } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Modal de sesión cerrada por inactividad
 * (change gestion-sesion-ux-modal-f5-error-banner · Pieza 4).
 *
 * Aparece cuando el aviso llega a `exp` sin que el usuario reaccione. Modal
 * FORZADO (sin cierre por "X", Escape ni overlay): la única salida es volver a
 * iniciar sesión. Mobile-first, sin overflow horizontal.
 */
type Props = {
  open: boolean;
  onLogin: () => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 sm:w-auto';

export const SessionExpiredModal = ({ open, onLogin }: Props) => (
  <Dialog open={open}>
    <DialogContent
      data-testid="modal-sesion-expirada"
      hideCloseButton
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
    >
      <DialogHeader className="items-center text-center sm:text-center">
        <div className="mb-2 flex size-16 items-center justify-center rounded-full bg-surface-muted">
          <LockKeyhole aria-hidden className="size-7 text-text-secondary" />
        </div>
        <DialogTitle>Tu sesión se ha cerrado por inactividad</DialogTitle>
        <DialogDescription>
          Por tu seguridad, hemos finalizado tu sesión. Vuelve a iniciar sesión para continuar.
        </DialogDescription>
      </DialogHeader>

      <DialogFooter className="sm:justify-center">
        <button
          type="button"
          onClick={onLogin}
          data-testid="boton-iniciar-sesion-expirada"
          className={claseBotonPrimario}
        >
          Iniciar sesión
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
