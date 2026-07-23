import { useEffect } from 'react';
import { Send, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAprobarEnviarLiquidacion } from '../api/useAprobarEnviarLiquidacion';
import { formatearEuros, formatearPorcentaje } from '../lib/dinero';
import { AvisoErrorLiquidacion } from './AvisoErrorLiquidacion';
import type { AprobarEnviarLiquidacionResponse, Factura } from '../model/types';

/**
 * Diálogo de confirmación de la acción "Aprobar y enviar" (US-028 · UC-21). El Gestor revisa
 * el total y el desglose fiscal y confirma. La confirmación dispara la emisión atómica
 * estado↔email (E4 con ambos PDFs); si el envío falla (502/503) se muestra un error
 * RECUPERABLE (nada cambió) y puede reintentarse.
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify" para US-028; se ADAPTA con los
 * tokens del proyecto reutilizando el tratamiento de los diálogos de facturación (US-022).
 * `Dialog` (shadcn/Radix) mobile-first; botones apilan en columna en móvil y el pie pasa a
 * fila en `sm:`. Objetivos táctiles ≥ 44px.
 */
type Props = {
  liquidacion: Factura;
  /** `true` si el recibo de fianza sigue en borrador (se emitirá junto con la liquidación). */
  fianzaPendiente: boolean;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Opcional: se invoca con la respuesta (liquidación emitida + status) tras un 200. */
  onEmitido?: (resultado: AprobarEnviarLiquidacionResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-8 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseFilaDesglose = 'flex items-center justify-between gap-4 font-body text-sm';

export const AprobarEnviarLiquidacionDialog = ({
  liquidacion,
  fianzaPendiente,
  abierto,
  onAbiertoChange,
  onEmitido,
}: Props) => {
  const aprobar = useAprobarEnviarLiquidacion();
  const { reset: resetAprobar } = aprobar;

  useEffect(() => {
    if (!abierto) {
      resetAprobar();
    }
  }, [abierto, resetAprobar]);

  const onConfirmar = () => {
    aprobar.mutate(
      { reservaId: liquidacion.reservaId },
      {
        onSuccess: (resultado) => {
          onEmitido?.(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-aprobar-enviar-liquidacion"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Aprobar y enviar la factura de liquidación</DialogTitle>
          <DialogDescription>
            Revisa el importe. Al aprobar, se emitirá la factura con su número fiscal y se
            enviará al cliente por email
            {fianzaPendiente ? ' junto con el recibo de fianza.' : '.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {aprobar.error && <AvisoErrorLiquidacion error={aprobar.error} />}

          <div className="flex flex-col gap-3 rounded-[16px] border border-border-default/50 bg-surface-subtle/40 p-4">
            <div className={claseFilaDesglose}>
              <span className="text-text-secondary">Base imponible</span>
              <strong data-testid="preview-base" className="font-display text-text-primary">
                {formatearEuros(liquidacion.baseImponible)}
              </strong>
            </div>
            <div className={claseFilaDesglose}>
              <span className="text-text-secondary">
                IVA ({formatearPorcentaje(liquidacion.ivaPorcentaje)})
              </span>
              <strong data-testid="preview-iva" className="font-display text-text-primary">
                {formatearEuros(liquidacion.ivaImporte)}
              </strong>
            </div>
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-border-default/40 pt-3 font-body text-base">
              <span className="font-medium text-text-primary">Total a facturar</span>
              <strong data-testid="preview-total" className="font-display text-brand-primary">
                {formatearEuros(liquidacion.total)}
              </strong>
            </div>
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={aprobar.isPending}
              data-testid="cancelar-aprobar-enviar"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={aprobar.isPending}
              data-testid="confirmar-aprobar-enviar"
              className={claseBotonPrimario}
            >
              <Send aria-hidden className="size-5" />
              {aprobar.isPending ? 'Emitiendo y enviando…' : 'Aprobar y enviar'}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
