import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { DialogFooter } from '@/components/ui/dialog';
import { formatearEuros } from '../lib/dinero';
import { formatearFecha } from '../lib/fecha';
import { AvisoErrorDevolucionFianza } from './AvisoErrorDevolucionFianza';
import type { DevolucionFianzaError, FianzaStatus } from '../model/types';

/**
 * Paso de **confirmación irreversible** de la devolución de fianza (US-036 · D-7). La acción no se
 * puede deshacer, así que antes de enviar se muestra un resumen de lo que se va a registrar y una
 * advertencia clara. Mobile-first: los botones apilan en columna en `<sm` y pasan a fila en `sm:`;
 * objetivos táctiles ≥ 48px.
 */
type Props = {
  importe: string;
  fechaCobro: string;
  resultado: FianzaStatus;
  motivoRetencion?: string;
  nombreJustificante?: string | null;
  error: DevolucionFianzaError | null;
  pendiente: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ConfirmacionDevolucionFianza = ({
  importe,
  fechaCobro,
  resultado,
  motivoRetencion,
  nombreJustificante,
  error,
  pendiente,
  onCancelar,
  onConfirmar,
}: Props) => (
  <div className="flex flex-col gap-5" data-testid="confirmacion-devolucion-fianza">
    {error && <AvisoErrorDevolucionFianza error={error} />}

    <div className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <p className="font-body text-sm">
        Esta acción es <strong className="font-semibold">irreversible</strong>. Revisa los datos
        antes de confirmar el registro de la devolución.
      </p>
    </div>

    <dl className="grid grid-cols-1 gap-3 rounded-[16px] border border-border-default/30 bg-surface-subtle/40 p-4 sm:grid-cols-2">
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Importe a devolver</dt>
        <dd className="font-display text-base font-bold text-text-primary">
          {formatearEuros(importe)}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Fecha de la devolución</dt>
        <dd className="font-display text-base font-semibold text-text-primary">
          {formatearFecha(fechaCobro)}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Estado final</dt>
        <dd className="font-body text-sm font-medium text-text-primary">
          {resultado === 'devuelta' ? 'Devolución completa' : 'Devolución parcial (retención)'}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Justificante</dt>
        <dd className="truncate font-body text-sm text-text-primary">
          {nombreJustificante ?? 'Sin adjuntar'}
        </dd>
      </div>
      {resultado === 'retenida_parcial' && motivoRetencion && (
        <div className="flex flex-col sm:col-span-2">
          <dt className="font-body text-xs text-text-secondary">Motivo de la retención</dt>
          <dd className="font-body text-sm text-text-primary">{motivoRetencion}</dd>
        </div>
      )}
    </dl>

    <DialogFooter className="flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendiente}
        data-testid="cancelar-confirmacion-devolucion"
        className={claseBotonSecundario}
      >
        <X aria-hidden className="size-5" />
        Volver
      </button>
      <button
        type="button"
        onClick={onConfirmar}
        disabled={pendiente}
        data-testid="confirmar-devolucion-fianza"
        className={claseBotonPrimario}
      >
        <RotateCcw aria-hidden className="size-5" />
        {pendiente ? 'Registrando…' : 'Confirmar devolución'}
      </button>
    </DialogFooter>
  </div>
);
