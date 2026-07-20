import { useEffect } from 'react';
import { AlertTriangle, Archive, X } from 'lucide-react';
import { notify } from '@/lib/notify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useArchivarReserva } from '../api/useArchivarReserva';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

/**
 * Diálogo de confirmación de la acción "Archivar reserva" (US-038 · UC-28, flujo
 * alternativo manual). El archivado `post_evento → reserva_completada` es terminal e
 * inmutable, así que se exige confirmación explícita antes de ejecutarlo.
 *
 * Al éxito muestra un toast "Reserva [código] archivada correctamente. Ya está
 * disponible en el Histórico." y la RESERVA sale del pipeline activo (US-049). Los
 * errores del backend se ramifican por el `code` (design.md §D-3=3.B):
 *  - 422 `fianza_no_resuelta` → mensaje de FA-01 (fianza pendiente de resolución).
 *  - 409 `transicion_no_permitida` → mensaje de conflicto ("ya no está en post-evento").
 *
 * Diseño: no hay frame propio de este diálogo en el archivo Figma "Slotify"; se
 * ADAPTA con los tokens del proyecto reutilizando el patrón de `FinalizarEventoDialog`
 * (US-034). El `Dialog` (shadcn/Radix) es mobile-first sin overflow horizontal; el pie
 * apila en columna en móvil (`<sm`) y pasa a fila en `sm:`. Objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** Código de la RESERVA (p. ej. `SLO-2026-0038`) para el toast de éxito. */
  codigo: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA archivada (`reserva_completada`) tras un 200. */
  onArchivado: (reserva: Reserva) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ArchivarReservaDialog = ({
  reservaId,
  codigo,
  abierto,
  onAbiertoChange,
  onArchivado,
}: Props) => {
  const mutation = useArchivarReserva();
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) resetMutation();
  }, [abierto, resetMutation]);

  const confirmar = () => {
    // El error (422 fianza / 409 conflicto / genérico) se muestra inline vía
    // `mutation.error`; la RESERVA no se muta en ninguno de esos casos.
    mutation.mutate(
      { id: reservaId },
      {
        onSuccess: (reserva) => {
          notify.success(
            `Reserva ${codigo} archivada correctamente. Ya está disponible en el Histórico.`,
          );
          onArchivado(reserva);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-archivar-reserva"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Archivar reserva</DialogTitle>
          <DialogDescription>
            La reserva pasará a <strong>completada</strong> y se archivará en el Histórico. Esta
            acción es irreversible y no se enviará ningún email al cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {mutation.error && (
            <div
              role="alert"
              data-testid="aviso-error-archivar-reserva"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">{mutation.error.mensaje}</p>
            </div>
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={mutation.isPending}
              data-testid="cancelar-archivar-reserva"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={mutation.isPending}
              data-testid="confirmar-archivar-reserva"
              className={claseBotonPrimario}
            >
              <Archive aria-hidden className="size-5" />
              {mutation.isPending ? 'Archivando…' : 'Archivar reserva'}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
