import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { DialogFooter } from '@/components/ui/dialog';
import { AvisoErrorCobroFianza } from './AvisoErrorCobroFianza';
import type { CobroFianzaError } from '../model/types';

/**
 * Panel del aviso "Negociable" (US-030 · design.md §D-2) dentro del diálogo de cobro de fianza.
 * Se muestra cuando el servidor responde `confirmacion_requerida` (`fianzaStatus='pendiente'`, el
 * recibo nunca se envió): renderiza el `mensaje` del contrato y ofrece "Cancelar" (sin acción) o
 * "Registrar el cobro igualmente" (reintenta con `confirmarSinRecibo: true`). Presentacional puro;
 * la lógica de reintento vive en el diálogo. Mobile-first: los botones apilan en `<sm`.
 */
type Props = {
  mensaje: string;
  error?: CobroFianzaError | null;
  pendiente: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ConfirmacionCobroNegociable = ({
  mensaje,
  error,
  pendiente,
  onCancelar,
  onConfirmar,
}: Props) => (
  <div className="flex flex-col gap-5" data-testid="confirmacion-negociable">
    {error && <AvisoErrorCobroFianza error={error} />}
    <div className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <p data-testid="mensaje-negociable">{mensaje}</p>
    </div>
    <DialogFooter className="flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendiente}
        data-testid="cancelar-negociable"
        className={claseBotonSecundario}
      >
        <X aria-hidden className="size-5" />
        Cancelar
      </button>
      <button
        type="button"
        onClick={onConfirmar}
        disabled={pendiente}
        data-testid="confirmar-negociable"
        className={claseBotonPrimario}
      >
        <ShieldCheck aria-hidden className="size-5" />
        {pendiente ? 'Registrando…' : 'Registrar el cobro igualmente'}
      </button>
    </DialogFooter>
  </div>
);
