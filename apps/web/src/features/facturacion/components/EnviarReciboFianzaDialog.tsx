import { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEnviarReciboFianza } from '../api/useEnviarReciboFianza';
import { formatearEuros } from '../lib/dinero';
import { AvisoErrorLiquidacion } from './AvisoErrorLiquidacion';
import type { EnviarReciboFianzaResponse, Factura } from '../model/types';

/**
 * Diálogo de confirmación de **envío separado del recibo de fianza** (US-028 · design.md §D-3).
 * Edge case sin liquidación: el Gestor envía al cliente **solo** el recibo de fianza. Al
 * confirmar, el recibo se emite (`estado='enviada'`, `numeroFactura` propio) y avanza
 * `fianzaStatus='recibo_enviado'`; `liquidacionStatus` NO cambia. Se registra como email
 * `manual` (no E4). Si el envío falla (502/503) se muestra un error RECUPERABLE (nada cambió).
 *
 * Diseño: sin frame propio en Figma "Slotify"; se ADAPTA con los tokens del proyecto.
 * `Dialog` (shadcn/Radix) mobile-first; botones apilan en columna en móvil.
 */
type Props = {
  fianza: Factura;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Opcional: se invoca con la respuesta (fianza emitida + `fianzaStatus`) tras un 200. */
  onEnviado?: (resultado: EnviarReciboFianzaResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const EnviarReciboFianzaDialog = ({
  fianza,
  abierto,
  onAbiertoChange,
  onEnviado,
}: Props) => {
  const enviar = useEnviarReciboFianza();
  const { reset: resetEnviar } = enviar;

  useEffect(() => {
    if (!abierto) resetEnviar();
  }, [abierto, resetEnviar]);

  const onEnviar = () => {
    enviar.mutate(
      { reservaId: fianza.reservaId },
      {
        onSuccess: (resultado) => {
          onEnviado?.(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-enviar-recibo-fianza"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Enviar el recibo de fianza por separado</DialogTitle>
          <DialogDescription>
            Se enviará al cliente un email con el recibo de fianza adjunto. La factura de
            liquidación no se ve afectada y podrás emitirla más tarde.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {enviar.error && <AvisoErrorLiquidacion error={enviar.error} />}

          <p className="rounded-[16px] border border-border-default/50 bg-surface-subtle/40 p-4 font-body text-sm text-text-primary">
            Importe del recibo de fianza:{' '}
            <strong data-testid="fianza-importe">{formatearEuros(fianza.total)}</strong>
          </p>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => onAbiertoChange(false)}
            disabled={enviar.isPending}
            data-testid="cancelar-enviar-fianza"
            className={claseBotonSecundario}
          >
            <X aria-hidden className="size-5" />
            Cancelar
          </button>
          <button
            type="button"
            onClick={onEnviar}
            disabled={enviar.isPending}
            data-testid="confirmar-enviar-fianza"
            className={claseBotonPrimario}
          >
            <ShieldCheck aria-hidden className="size-5" />
            {enviar.isPending ? 'Enviando…' : 'Enviar recibo de fianza'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
