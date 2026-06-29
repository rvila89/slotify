import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Calendar, CalendarX, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { hoyISO, mananaISO } from '../lib/fecha';
import { useAsignarFecha, type AsignarFechaError } from '../api/useAsignarFecha';
import type { Reserva } from '../model/types';

/**
 * Diálogo de la acción "Añadir fecha" (US-005 · UC-04) sobre una consulta en
 * sub-estado `2a`. Dispara la transición `2.a → 2.b/2.d` contra el SDK generado
 * (`POST /reservas/{id}/fecha`) y resuelve el flujo interactivo de la cola.
 *
 * Diseño: NO existe un frame propio de "ficha de consulta" ni de este diálogo en
 * el archivo Figma "Slotify" (el mapeo frame→US solo cubre listado de Reservas
 * `0:523`/US-042, ajeno a esta US). Se ADAPTA con los tokens del proyecto
 * (`index.css` + `DESIGN.md`): superficie `bg-canvas`, bordes `border-default`,
 * inputs `rounded-[12px]`, tipografía Epilogue (display) + Manrope (body), e
 * idéntico tratamiento del selector de fecha que `NuevaConsultaPage` (input
 * `type="date"` nativo con icono `Calendar` superpuesto). El componente `Dialog`
 * (shadcn/Radix) ya es mobile-first: `w-[calc(100%-2rem)]` con margen lateral en
 * móvil y `max-w-lg` en pantallas mayores, sin overflow horizontal.
 *
 * Flujo:
 *  - Paso "form": el gestor elige una fecha estrictamente futura (`> hoy`, D-1;
 *    el picker bloquea hoy y pasado con `min = mañana`, y el schema Zod lo refuerza
 *    ante bypass) y confirma.
 *  - 200 `2b` / `2d`: éxito → `onResuelto(reserva)` (la página muestra el aviso) y cierra.
 *  - 409 `colaDisponible=true`: pasa al paso "confirmar-cola" ("La fecha está
 *    ocupada. ¿Entrar en cola?"); al aceptar re-dispara con `aceptarCola=true`,
 *    al rechazar vuelve al form (la RESERVA permanece en `2a`).
 *  - 409 `colaDisponible=false`: aviso inline "no disponible", sin opción de cola.
 *  - 400/422: mensaje de fecha/estado no válido en el campo.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA actualizada tras una transición 200 (2b o 2d). */
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

export const AnadirFechaDialog = ({ reservaId, abierto, onAbiertoChange, onResuelto }: Props) => {
  // Paso del diálogo: el formulario de fecha o la confirmación de entrada en cola.
  const [paso, setPaso] = useState<'form' | 'confirmar-cola'>('form');
  const [errorAsignacion, setErrorAsignacion] = useState<AsignarFechaError | null>(null);

  const mutation = useAsignarFecha();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    getValues,
    formState: { errors },
  } = useForm<FormularioFecha>({
    resolver: zodResolver(esquema),
    defaultValues: { fechaEvento: '' },
  });

  const fechaSeleccionada = watch('fechaEvento');

  // Al cerrar el diálogo se resetea todo su estado interno para no arrastrar
  // fechas/errores entre aperturas.
  useEffect(() => {
    if (!abierto) {
      setPaso('form');
      setErrorAsignacion(null);
      mutation.reset();
      reset({ fechaEvento: '' });
    }
  }, [abierto, mutation, reset]);

  const manejarError = (err: AsignarFechaError) => {
    if (err.tipo === 'cola-disponible') {
      setErrorAsignacion(err);
      setPaso('confirmar-cola');
      return;
    }
    if (err.tipo === 'validacion') {
      setError('fechaEvento', { message: err.mensaje });
      setErrorAsignacion(null);
      return;
    }
    // no-disponible / generico: aviso inline en el form.
    setErrorAsignacion(err);
    setPaso('form');
  };

  const enviar = (fechaEvento: string, aceptarCola: boolean) => {
    setErrorAsignacion(null);
    mutation.mutate(
      { id: reservaId, body: { fechaEvento, ...(aceptarCola ? { aceptarCola: true } : {}) } },
      {
        onSuccess: (reserva) => {
          onResuelto(reserva);
          onAbiertoChange(false);
        },
        onError: manejarError,
      },
    );
  };

  const onSubmit = handleSubmit((valores) => enviar(valores.fechaEvento, false));

  const aceptarCola = () => enviar(getValues('fechaEvento'), true);
  const rechazarCola = () => {
    setPaso('form');
    setErrorAsignacion(null);
  };

  const avisoNoDisponible =
    errorAsignacion && (errorAsignacion.tipo === 'no-disponible' || errorAsignacion.tipo === 'generico')
      ? errorAsignacion
      : null;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-anadir-fecha">
        {paso === 'form' ? (
          <>
            <DialogHeader>
              <DialogTitle>Añadir fecha al evento</DialogTitle>
              <DialogDescription>
                Indica una fecha para intentar reservarla. Solo se admiten fechas posteriores a
                hoy. Si la fecha está libre se bloqueará provisionalmente y se avisará al cliente.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="anadir-fecha-evento" className={claseLabel}>
                  Fecha del evento
                </label>
                <div className="relative">
                  <input
                    id="anadir-fecha-evento"
                    type="date"
                    min={mananaISO()}
                    aria-invalid={errors.fechaEvento ? 'true' : undefined}
                    aria-describedby={errors.fechaEvento ? 'anadir-fecha-evento-error' : undefined}
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
                  <p
                    id="anadir-fecha-evento-error"
                    role="alert"
                    className="px-1 font-body text-[13px] text-red-600"
                  >
                    {errors.fechaEvento.message}
                  </p>
                )}
              </div>

              {avisoNoDisponible && (
                <div
                  role="alert"
                  data-testid="aviso-no-disponible"
                  className="flex items-start gap-3 rounded-[16px] border border-border-default bg-surface-muted p-4 text-text-primary"
                >
                  <CalendarX aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
                  <p className="font-body text-sm text-text-secondary">
                    {avisoNoDisponible.tipo === 'no-disponible'
                      ? avisoNoDisponible.motivo
                      : avisoNoDisponible.mensaje}
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
                <button type="submit" disabled={mutation.isPending} className={claseBotonPrimario}>
                  {mutation.isPending ? 'Asignando…' : 'Añadir fecha'}
                </button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>La fecha está ocupada</DialogTitle>
              <DialogDescription>
                {errorAsignacion?.tipo === 'cola-disponible'
                  ? errorAsignacion.motivo
                  : 'Otra consulta ya tiene reservada esta fecha.'}
              </DialogDescription>
            </DialogHeader>

            <div
              role="status"
              data-testid="oferta-cola"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
            >
              <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <p className="font-body text-sm">
                Puedes <strong>entrar en la cola de espera</strong> para esta fecha: si se libera,
                tu consulta tendrá prioridad por orden de llegada. La consulta permanecerá como
                exploratoria si no entras en cola.
              </p>
            </div>

            <DialogFooter>
              <button type="button" onClick={rechazarCola} className={claseBotonSecundario}>
                No, gracias
              </button>
              <button
                type="button"
                onClick={aceptarCola}
                disabled={mutation.isPending}
                data-testid="confirmar-cola"
                className={claseBotonPrimario}
              >
                {mutation.isPending ? 'Entrando en cola…' : 'Entrar en cola'}
              </button>
            </DialogFooter>
          </>
        )}

        {errorAsignacion?.tipo === 'generico' && paso === 'confirmar-cola' && (
          <p role="alert" className="flex items-center gap-2 font-body text-[13px] text-red-600">
            <AlertTriangle aria-hidden className="size-4" />
            {errorAsignacion.mensaje}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};
