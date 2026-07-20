import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, UserX, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDescartarConsulta } from '../api/useDescartarConsulta';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

/**
 * Diálogo de confirmación de la acción "Marcar como descartada por cliente"
 * (US-013 · UC-10, A17 manual). La transición `2a/2b/2c/2d/2v → 2z` es TERMINAL e
 * inmutable, así que se exige confirmación explícita antes de ejecutarla.
 *
 * Campo `motivo` OPCIONAL (textarea, React Hook Form + Zod): si el gestor lo
 * escribe, el backend lo anexa a `RESERVA.notas`; su ausencia NO bloquea ni
 * retrasa la transición (US-013 §Validación, FA "motivo no proporcionado").
 *
 * Al éxito notifica `onDescartado(reserva)` (la consulta pasa a `2z`, sale del
 * pipeline; si el origen tenía cola, la promoción/reordenación A15 se refleja al
 * re-consultar el pipeline — ver `useDescartarConsulta`); la confirmación se muestra
 * como aviso inline verde en la cabecera de la ficha (no como toast). El error del
 * backend se muestra inline:
 *  - 409 `transicion_no_permitida` (RC-3 doble descarte / origen terminal) →
 *    mensaje informativo del contrato; la UI no se rompe.
 *
 * Diseño: NO existe un frame propio de la ficha de consulta ni de este diálogo en
 * el archivo Figma "Slotify" (el mapeo frame→US de `docs/DESIGN.md` solo cubre
 * Login `0:3/0:304`, Calendario `0:86`, Nueva Reserva `0:382`, Reservas `0:523`,
 * Dashboard `0:742`). Se ADAPTA con los tokens del proyecto reutilizando el patrón
 * de `ArchivarReservaDialog` (US-038, acción terminal vecina). El `Dialog`
 * (shadcn/Radix) es mobile-first sin overflow horizontal; el pie apila en columna
 * en móvil (`<sm`) y pasa a fila en `sm:`. Objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** Código de la RESERVA (p. ej. `SLO-2026-0013`); lo consume el aviso inline de la
      ficha vía `onDescartado`, no este diálogo. */
  codigo?: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA descartada (`subEstado='2z'`) tras un 200. */
  onDescartado: (reserva: Reserva) => void;
};

const MOTIVO_MAX = 1000;

const esquemaDescarte = z.object({
  motivo: z.string().max(MOTIVO_MAX, `El motivo no puede superar ${MOTIVO_MAX} caracteres.`),
});

type FormularioDescarte = z.infer<typeof esquemaDescarte>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseTextarea =
  'min-h-24 w-full resize-y rounded-[16px] border border-border-default bg-canvas p-4 font-body text-base text-text-primary outline-none transition placeholder:text-text-secondary/70 focus-visible:ring-2 focus-visible:ring-brand-primary/40 disabled:cursor-not-allowed disabled:opacity-60';

export const DescartarConsultaDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onDescartado,
}: Props) => {
  const mutation = useDescartarConsulta();
  const { reset: resetMutation } = mutation;

  const { register, handleSubmit, reset, formState } = useForm<FormularioDescarte>({
    resolver: zodResolver(esquemaDescarte),
    defaultValues: { motivo: '' },
  });

  useEffect(() => {
    if (!abierto) {
      resetMutation();
      reset({ motivo: '' });
    }
  }, [abierto, resetMutation, reset]);

  const confirmar = handleSubmit(({ motivo }) => {
    // El error (409 conflicto / genérico) se muestra inline vía `mutation.error`;
    // la RESERVA no se muta en ninguno de esos casos.
    mutation.mutate(
      { id: reservaId, motivo },
      {
        onSuccess: (reserva) => {
          onDescartado(reserva);
          onAbiertoChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-descartar-consulta"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Marcar como descartada por cliente</DialogTitle>
          <DialogDescription>
            La consulta pasará a <strong>descartada por cliente</strong> (estado terminal). Si tenía
            una fecha bloqueada se liberará y, si había cola de espera, se promoverá al siguiente.
            Esta acción es irreversible y no se enviará ningún email al cliente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={confirmar} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-2">
            <label htmlFor="motivo-descarte" className="font-body text-sm font-medium text-text-primary">
              Motivo del descarte <span className="text-text-secondary">(opcional)</span>
            </label>
            <textarea
              id="motivo-descarte"
              data-testid="motivo-descartar-consulta"
              rows={3}
              maxLength={MOTIVO_MAX}
              disabled={mutation.isPending}
              placeholder="Ej.: El cliente ha decidido celebrar el evento en otra ubicación."
              className={claseTextarea}
              {...register('motivo')}
            />
            <p className="font-body text-xs text-text-secondary">
              Se anexará a las notas de la consulta. Puedes dejarlo en blanco.
            </p>
            {formState.errors.motivo && (
              <p role="alert" className="font-body text-xs text-red-600">
                {formState.errors.motivo.message}
              </p>
            )}
          </div>

          {mutation.error && (
            <div
              role="alert"
              data-testid="aviso-error-descartar-consulta"
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
              data-testid="cancelar-descartar-consulta"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              data-testid="confirmar-descartar-consulta"
              className={claseBotonPrimario}
            >
              <UserX aria-hidden className="size-5" />
              {mutation.isPending ? 'Descartando…' : 'Marcar como descartada'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
