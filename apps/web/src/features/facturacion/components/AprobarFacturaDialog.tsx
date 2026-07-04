import { CheckCircle2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAprobarFactura } from '../api/useAprobarFactura';
import { formatearEuros } from '../lib/dinero';
import { AvisoErrorFactura } from './AvisoErrorFactura';
import type { FacturaSenal } from '../model/types';

/**
 * Diálogo de confirmación de la **aprobación** del borrador de la factura de señal
 * (US-022 · UC-18). Flujo: abrir → revisar el importe total → **Aprobar** (POST al
 * backend, que eleva la factura a `enviada`, asigna `numeroFactura` y fija
 * `fechaEmision`) o **Cancelar** (sin efecto). El Gestor NO puede modificar importes
 * ni datos fiscales (inmutables, provienen de RESERVA y CLIENTE).
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify"; se ADAPTA con los
 * tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el tratamiento de
 * los diálogos de confirmación/reservas. `Dialog` (shadcn/Radix) mobile-first
 * (`w-[calc(100%-2rem)]`, `max-w-lg`); los botones apilan en columna en móvil y el
 * pie pasa a fila en `sm:`. Objetivos táctiles ≥ 44px.
 */
type Props = {
  factura: FacturaSenal;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la factura ya `enviada` tras un 200. */
  onAprobado: (factura: FacturaSenal) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const AprobarFacturaDialog = ({ factura, abierto, onAbiertoChange, onAprobado }: Props) => {
  const aprobar = useAprobarFactura();

  const onAprobar = () => {
    aprobar.mutate(
      { id: factura.idFactura, reservaId: factura.reservaId },
      {
        onSuccess: (aprobada) => {
          onAprobado(aprobada);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (!v) aprobar.reset();
        onAbiertoChange(v);
      }}
    >
      <DialogContent data-testid="dialog-aprobar-factura" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aprobar factura de señal</DialogTitle>
          <DialogDescription>
            Al aprobar, la factura pasará a enviada, se le asignará su número fiscal y quedará lista
            para adjuntarse al cliente. Los importes y los datos fiscales no pueden modificarse.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {aprobar.error && <AvisoErrorFactura error={aprobar.error} />}

          <p className="rounded-[16px] border border-border-default/50 bg-surface-subtle/40 p-4 font-body text-sm text-text-primary">
            Importe total de la factura:{' '}
            <strong data-testid="aprobar-importe">{formatearEuros(factura.total)}</strong>
          </p>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => onAbiertoChange(false)}
            disabled={aprobar.isPending}
            data-testid="cancelar-aprobar-factura"
            className={claseBotonSecundario}
          >
            <X aria-hidden className="size-5" />
            Cancelar
          </button>
          <button
            type="button"
            onClick={onAprobar}
            disabled={aprobar.isPending}
            data-testid="confirmar-aprobar-factura"
            className={claseBotonPrimario}
          >
            <CheckCircle2 aria-hidden className="size-5" />
            {aprobar.isPending ? 'Aprobando…' : 'Aprobar factura'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
