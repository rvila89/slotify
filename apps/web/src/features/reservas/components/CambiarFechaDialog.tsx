import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Calendar, CalendarRange, CalendarX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatearFecha, hoyISO, mananaISO } from '../lib/fecha';
import { useCambiarFecha, type CambiarFechaError } from '../api/useCambiarFecha';
import type { Reserva } from '../model/types';

/**
 * Diálogo "Cambiar fecha" (US-051 §D-2.1) sobre una consulta con fecha YA
 * bloqueada (`2b`/`2c`/`2v`). Dispara la operación atómica
 * `POST /reservas/{id}/cambiar-fecha` (SDK generado): libera la fecha antigua y
 * bloquea la nueva en UNA transacción. A diferencia de "Añadir fecha", aquí NO se
 * ofrece cola: un 409 (fecha destino ocupada) es terminal y muestra su `motivo`.
 *
 * Diseño: NO existe frame propio en Figma "Slotify"; se ADAPTA con los tokens del
 * proyecto reutilizando el tratamiento de `AnadirFechaDialog` (input `type="date"`
 * nativo con icono superpuesto, `min = mañana`). El `Dialog` shadcn es mobile-first.
 */
type Props = {
  reservaId: string;
  reserva: Reserva;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA actualizada tras un 200 (nueva `fechaEvento`). */
  onResuelto: (reserva: Reserva) => void;
};

const esquema = z.object({
  fechaEvento: z
    .string()
    .min(1, 'Selecciona una fecha para el evento')
    .refine((v) => v > hoyISO(), {
      message: 'La fecha del evento debe ser posterior a hoy',
    }),
});

type FormularioFecha = z.infer<typeof esquema>;

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const CambiarFechaDialog = ({
  reservaId,
  reserva,
  abierto,
  onAbiertoChange,
  onResuelto,
}: Props) => {
  const mutation = useCambiarFecha();
  const { reset: resetMutation } = mutation;

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormularioFecha>({
    resolver: zodResolver(esquema),
    defaultValues: { fechaEvento: '' },
  });

  const fechaSeleccionada = watch('fechaEvento');

  useEffect(() => {
    if (!abierto) {
      resetMutation();
      reset({ fechaEvento: '' });
    }
  }, [abierto, resetMutation, reset]);

  const manejarError = (err: CambiarFechaError) => {
    if (err.tipo === 'validacion') {
      setError('fechaEvento', { message: err.mensaje });
      return;
    }
    // no-disponible / generico: aviso inline (root).
    setError('root', { message: err.tipo === 'no-disponible' ? err.motivo : err.mensaje });
  };

  const onSubmit = handleSubmit(({ fechaEvento }) => {
    mutation.mutate(
      { id: reservaId, body: { fechaEvento } },
      {
        onSuccess: (actualizada) => {
          onResuelto(actualizada);
          onAbiertoChange(false);
        },
        onError: manejarError,
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-cambiar-fecha">
        <DialogHeader>
          <DialogTitle>Cambiar la fecha del evento</DialogTitle>
          <DialogDescription>
            La fecha actual es{' '}
            <strong>
              {reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : 'sin asignar'}
            </strong>
            . Al cambiarla se liberará la fecha anterior y se bloqueará la nueva. Si la nueva fecha
            ya está ocupada, el cambio se rechazará sin efectos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="cambiar-fecha-evento" className={claseLabel}>
              Nueva fecha del evento
            </label>
            <div className="relative">
              <input
                id="cambiar-fecha-evento"
                type="date"
                min={mananaISO()}
                aria-invalid={errors.fechaEvento ? 'true' : undefined}
                aria-describedby={errors.fechaEvento ? 'cambiar-fecha-evento-error' : undefined}
                {...register('fechaEvento')}
                className={cn(
                  claseInput,
                  'appearance-none pr-12 [color-scheme:light]',
                  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:top-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-12 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0',
                  !fechaSeleccionada && 'text-text-secondary/60',
                )}
              />
              <Calendar
                aria-hidden
                className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
              />
            </div>
            {errors.fechaEvento && (
              <p id="cambiar-fecha-evento-error" role="alert" className="px-1 font-body text-[13px] text-red-600">
                {errors.fechaEvento.message}
              </p>
            )}
          </div>

          {errors.root && (
            <div
              role="alert"
              data-testid="aviso-cambiar-fecha-no-disponible"
              className="flex items-start gap-3 rounded-[16px] border border-border-default bg-surface-muted p-4 text-text-primary"
            >
              <CalendarX aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
              <p className="font-body text-sm text-text-secondary">{errors.root.message}</p>
            </div>
          )}

          <DialogFooter>
            <button type="button" onClick={() => onAbiertoChange(false)} className={claseBotonSecundario}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              data-testid="confirmar-cambiar-fecha"
              className={claseBotonPrimario}
            >
              <CalendarRange aria-hidden className="size-5" />
              {mutation.isPending ? 'Cambiando…' : 'Cambiar fecha'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
