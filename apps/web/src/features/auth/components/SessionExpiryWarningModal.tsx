import { ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Aviso de expiración de sesión con countdown
 * (change gestion-sesion-ux-modal-f5-error-banner · Pieza 4).
 *
 * Modal FORZADO (no cerrable por "X" ni por Escape/overlay): solo sale por una de
 * sus dos acciones. Muestra un countdown circular (SVG animado con
 * `stroke-dashoffset`) sincronizado con `secondsLeft` (60→0). Mobile-first: el
 * `DialogContent` ocupa el ancho disponible con margen lateral en móvil y acota su
 * ancho en pantallas mayores; el pie apila en columna en móvil y pasa a fila en
 * `sm:`. Se oculta el botón "Cerrar" por defecto del `DialogContent`
 * (`[&>button]:hidden`) para que sea un modal forzado.
 */
type Props = {
  open: boolean;
  secondsLeft: number;
  onKeepSession: () => void;
  onLogout: () => void;
};

const DURACION_AVISO = 60;
const RADIO = 32;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonGhost =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-8 font-body text-base font-medium text-text-secondary underline-offset-4 transition hover:text-text-primary hover:underline sm:w-auto';

export const SessionExpiryWarningModal = ({
  open,
  secondsLeft,
  onKeepSession,
  onLogout,
}: Props) => {
  const acotado = Math.max(0, Math.min(secondsLeft, DURACION_AVISO));
  const offset = CIRCUNFERENCIA * (1 - acotado / DURACION_AVISO);

  return (
    <Dialog open={open}>
      <DialogContent
        data-testid="modal-aviso-expiracion"
        // Modal forzado: sin cierre por overlay/Escape ni botón "X".
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="relative mb-2 flex size-20 items-center justify-center">
            <svg className="size-20 -rotate-90" viewBox="0 0 80 80" aria-hidden>
              <circle
                cx="40"
                cy="40"
                r={RADIO}
                fill="none"
                strokeWidth="6"
                className="stroke-border-default"
              />
              <circle
                cx="40"
                cy="40"
                r={RADIO}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={CIRCUNFERENCIA}
                strokeDashoffset={offset}
                className="stroke-brand-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            <span
              data-testid="countdown-segundos"
              className="absolute inset-0 flex items-center justify-center font-display text-xl font-bold text-text-primary"
            >
              {acotado}
            </span>
          </div>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5 text-brand-primary" />
            ¿Quieres mantener activa la sesión?
          </DialogTitle>
          <DialogDescription>
            Por tu seguridad, tu sesión se cerrará por inactividad.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onLogout}
            data-testid="boton-cerrar-sesion-aviso"
            className={claseBotonGhost}
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={onKeepSession}
            data-testid="boton-mantener-sesion"
            className={claseBotonPrimario}
          >
            Mantener sesión
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
