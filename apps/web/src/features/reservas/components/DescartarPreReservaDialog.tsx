import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Ban, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDescartarPreReserva } from '../api/useDescartarPreReserva';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

/**
 * Diálogo de confirmación de la acción "Descartar pre-reserva" (workstream B de
 * `presupuesto-prereserva-cta-descarte-y-e2`). La transición `pre_reserva →
 * reserva_cancelada` es TERMINAL e irreversible, así que se exige confirmación
 * explícita antes de ejecutarla (espejo de `DescartarConsultaDialog` de US-013).
 *
 * Campo `motivo` OPCIONAL (textarea, React Hook Form + Zod): si el gestor lo
 * escribe, el backend lo audita en `AUDIT_LOG`; su ausencia NO bloquea la
 * transición.
 *
 * Al éxito muestra un toast y la reserva pasa a `reserva_cancelada` (sale del
 * pipeline; si la fecha tenía cola, la promoción/reordenación A15 se refleja al
 * re-consultar el pipeline — ver `useDescartarPreReserva`). El error del backend se
 * muestra inline:
 *  - 409 `transicion_no_permitida` (RESERVA ya terminal / carrera perdida) →
 *    mensaje informativo; la UI no se rompe.
 *  - 422 origen inválido (estado no descartable) → mensaje informativo.
 *
 * Diseño: NO existe un frame propio de la ficha ni de este diálogo en el archivo
 * Figma "Slotify" (el mapeo frame→US de `docs/DESIGN.md` no cubre la ficha). Se
 * ADAPTA con los tokens del proyecto reutilizando el patrón de
 * `DescartarConsultaDialog` (acción terminal vecina). El `Dialog` (shadcn/Radix) es
 * mobile-first sin overflow horizontal; el pie apila en columna en móvil (`<sm`) y
 * pasa a fila en `sm:`. Objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** Código de la RESERVA (p. ej. `SLO-2026-0021`) para el toast de éxito. */
  codigo: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA descartada (`estado='reserva_cancelada'`) tras un 200. */
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

export const DescartarPreReservaDialog = ({
  reservaId,
  codigo,
  abierto,
  onAbiertoChange,
  onDescartado,
}: Props) => {
  const mutation = useDescartarPreReserva();
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
    // El error (409 conflicto / 422 origen inválido / genérico) se muestra inline
    // vía `mutation.error`; la RESERVA no se muta en ninguno de esos casos.
    mutation.mutate(
      { id: reservaId, motivo },
      {
        onSuccess: (reserva) => {
          toast.success(`Pre-reserva ${codigo} descartada.`);
          onDescartado(reserva);
          onAbiertoChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-descartar-prereserva"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Descartar pre-reserva</DialogTitle>
          <DialogDescription>
            La pre-reserva pasará a <strong>cancelada</strong> (estado terminal). La fecha
            bloqueada se liberará y, si había cola de espera, se promoverá al siguiente. Esta
            acción es irreversible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={confirmar} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="motivo-descartar-prereserva"
              className="font-body text-sm font-medium text-text-primary"
            >
              Motivo del descarte <span className="text-text-secondary">(opcional)</span>
            </label>
            <textarea
              id="motivo-descartar-prereserva"
              data-testid="motivo-descartar-prereserva"
              rows={3}
              maxLength={MOTIVO_MAX}
              disabled={mutation.isPending}
              placeholder="Ej.: El cliente no ha realizado el pago de la señal en plazo."
              className={claseTextarea}
              {...register('motivo')}
            />
            <p className="font-body text-xs text-text-secondary">
              Se registrará en la auditoría de la reserva. Puedes dejarlo en blanco.
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
              data-testid="aviso-error-descartar-prereserva"
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
              data-testid="cancelar-descartar-prereserva"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              data-testid="confirmar-descartar-prereserva"
              className={claseBotonPrimario}
            >
              <Ban aria-hidden className="size-5" />
              {mutation.isPending ? 'Descartando…' : 'Descartar pre-reserva'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
