import { useEffect } from 'react';
import { Ban, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDescartarBorrador } from '../api/useDescartarBorrador';
import { AvisoErrorComunicacion } from './AvisoErrorComunicacion';
import type { ComunicacionListItem } from '../model/types';

/**
 * Diálogo de confirmación de "Descartar borrador" (US-046 · UC-36). El descarte no
 * envía email: el borrador pasa a `fallido` (con `AUDIT_LOG` "descartado por gestor")
 * y desaparece de la bandeja de pendientes. Se exige confirmación explícita.
 *
 * Al éxito muestra un toast y refresca la lista (la mutación invalida la query). Un 409
 * `ESTADO_NO_BORRADOR` (ya no es borrador) se avisa y se cierra (la lista se refresca).
 *
 * Diseño adaptado con los tokens del proyecto (sin frame propio en Figma "Slotify"),
 * reutilizando el patrón de `ArchivarReservaDialog`. Mobile-first, sin overflow.
 */
type Props = {
  reservaId: string;
  borrador: ComunicacionListItem | null;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-600 px-8 font-display text-base text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const DescartarBorradorDialog = ({
  reservaId,
  borrador,
  abierto,
  onAbiertoChange,
}: Props) => {
  const descartar = useDescartarBorrador();
  const { reset: resetDescartar } = descartar;

  useEffect(() => {
    if (!abierto) resetDescartar();
  }, [abierto, resetDescartar]);

  if (!borrador) return null;

  const confirmar = () => {
    descartar.mutate(
      { reservaId, idComunicacion: borrador.idComunicacion },
      {
        onSuccess: () => {
          toast.success('Borrador descartado. Ya no aparece en las comunicaciones pendientes.');
          onAbiertoChange(false);
        },
        onError: (err) => {
          if (err.tipo === 'conflicto') {
            toast.info(err.mensaje);
            onAbiertoChange(false);
          }
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-descartar-borrador"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Descartar borrador</DialogTitle>
          <DialogDescription>
            El borrador «{borrador.asunto}» se descartará y <strong>no se enviará</strong> ningún
            email al cliente. Esta acción no se puede deshacer; el descarte queda registrado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {descartar.error && (
            <AvisoErrorComunicacion
              mensaje={descartar.error.mensaje}
              testId="aviso-error-descartar-borrador"
            />
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={descartar.isPending}
              data-testid="cancelar-descartar-borrador"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={descartar.isPending}
              data-testid="confirmar-descartar-borrador"
              className={claseBotonPrimario}
            >
              <Ban aria-hidden className="size-5" />
              {descartar.isPending ? 'Descartando…' : 'Descartar borrador'}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
