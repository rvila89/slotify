import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  usePendienteInvitados,
  type PendienteInvitadosError,
} from '../api/usePendienteInvitados';
import type { PendienteInvitadosResultado } from '../model/types';

/**
 * Diálogo de confirmación de la acción "Marcar como pendiente de invitados"
 * (US-007 · UC-06) sobre una consulta en sub-estado `2b` con bloqueo vigente.
 * Dispara la transición `2.b → 2.c` contra el SDK generado
 * (`POST /reservas/{id}/pendiente-invitados`, body `{}`): extiende el TTL del
 * bloqueo y vacía la cola de la fecha (A16). NO envía email (D-7): el feedback de
 * éxito vive en la ficha y muestra el nuevo TTL + el recuento de consultas
 * descartadas de la cola.
 *
 * Diseño: NO existe un frame propio de este diálogo en el archivo Figma "Slotify"
 * (el mapeo frame→US cubre solo el listado de Reservas, ajeno a esta US). Se ADAPTA
 * con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el mismo
 * tratamiento de `AnadirFechaDialog` (US-005): superficie `bg-canvas`, bordes
 * `border-default`, tipografía Epilogue (display) + Manrope (body). El `Dialog`
 * (shadcn/Radix) ya es mobile-first (`w-[calc(100%-2rem)]` con margen lateral en
 * móvil, `max-w-lg` en pantallas mayores), sin overflow horizontal.
 *
 * Flujo:
 *  - 200: éxito → `onResuelto(resultado)` (la ficha muestra el aviso TTL + cola) y cierra.
 *  - 409 `bloqueo-no-vigente`: aviso inline con `motivo` (el bloqueo expiró o ya no existe).
 *  - 422 `guarda-origen`: aviso inline (la consulta ya no está en `2b`).
 *  - genérico: aviso de reintento.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con el resultado (RESERVA en 2c + recuento de cola) tras un 200. */
  onResuelto: (resultado: PendienteInvitadosResultado) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const PendienteInvitadosDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onResuelto,
}: Props) => {
  const [error, setError] = useState<PendienteInvitadosError | null>(null);
  const mutation = usePendienteInvitados();

  // Al cerrar el diálogo se resetea su estado interno para no arrastrar errores.
  useEffect(() => {
    if (!abierto) {
      setError(null);
      mutation.reset();
    }
  }, [abierto, mutation]);

  const confirmar = () => {
    setError(null);
    mutation.mutate(
      { id: reservaId },
      {
        onSuccess: (data) => {
          onResuelto({
            reserva: data.reserva,
            consultasDescartadas: data.consultasDescartadas,
          });
          onAbiertoChange(false);
        },
        onError: setError,
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-pendiente-invitados">
        <DialogHeader>
          <DialogTitle>Marcar como pendiente de invitados</DialogTitle>
          <DialogDescription>
            La consulta pasará a <strong>pendiente de número de invitados</strong>. Se ampliará el
            plazo del bloqueo de la fecha y se vaciará su cola de espera. Esta acción no se puede
            deshacer.
          </DialogDescription>
        </DialogHeader>

        <div
          role="note"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p className="font-body text-sm">
            Las consultas que estuvieran <strong>en cola</strong> para esta fecha se descartarán de
            forma definitiva.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="aviso-error-pendiente-invitados"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">
              {error.tipo === 'bloqueo-no-vigente' ? error.motivo : error.mensaje}
            </p>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onAbiertoChange(false)}
            className={claseBotonSecundario}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={mutation.isPending}
            data-testid="confirmar-pendiente-invitados"
            className={claseBotonPrimario}
          >
            <Users aria-hidden className="size-5" />
            {mutation.isPending ? 'Aplicando…' : 'Confirmar'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
