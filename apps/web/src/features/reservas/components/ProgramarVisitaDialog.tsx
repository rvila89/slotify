import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CalendarClock, ChevronDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { hoyISO, hoyMasDiasISO, mananaISO } from '../lib/fecha';
import { useProgramarVisita, type ProgramarVisitaError } from '../api/useProgramarVisita';
import type { Reserva } from '../model/types';

/**
 * Diálogo de la acción "Programar visita" (US-008 · UC-07) sobre una consulta en
 * sub-estado `2a`/`2b`/`2c`. Dispara la transición `→ 2.v` contra el SDK generado
 * (`POST /reservas/{id}/visita`, body `{ fecha, hora }`): fija la fecha/hora de la
 * visita, extiende el bloqueo de la fecha del evento hasta el día posterior a la
 * visita y envía el email E6 al cliente.
 *
 * Diseño: NO existe un frame propio de "ficha de consulta" ni de este diálogo en el
 * archivo Figma "Slotify" (el mapeo frame→US solo cubre el listado de Reservas
 * `0:523`/US-042, ajeno a esta US). Se ADAPTA con los tokens del proyecto
 * (`index.css` + `DESIGN.md`), reutilizando el mismo tratamiento de
 * `AnadirFechaDialog` (US-005): superficie `bg-canvas`, bordes `border-default`,
 * inputs `rounded-[12px]`, tipografía Epilogue (display) + Manrope (body), selector
 * de fecha nativo (`type="date"`) con icono superpuesto y selector de hora nativo
 * (`type="time"`). El `Dialog` (shadcn/Radix) ya es mobile-first
 * (`w-[calc(100%-2rem)]` con margen lateral en móvil, `max-w-lg` en pantallas
 * mayores), sin overflow horizontal.
 *
 * Validación cliente coherente con el servidor (defensivo, fuente de verdad):
 *  - `fecha ∈ [mañana, hoy + maxDias]` (picker acotado por `min`/`max` + refine Zod
 *    ante bypass). El servidor revalida (422 fuera de ventana / 2a sin fechaEvento).
 *  - `hora` en formato 24h `HH:mm`.
 *
 * Flujo:
 *  - 200 `2v`: éxito → `onResuelto(reserva)` (la ficha muestra el aviso) y cierra.
 *  - 409 `cola`: aviso inline con `motivo` (promover primero, UC-12).
 *  - 422 `validacion`: mensaje del servidor en el campo de fecha.
 *  - genérico: aviso de reintento.
 */
type Props = {
  reservaId: string;
  /** Días máximos para programar la visita (TENANT_SETTINGS.max_dias_programar_visita, default 7). */
  maxDias: number;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA actualizada (subEstado='2v') tras un 200. */
  onResuelto: (reserva: Reserva) => void;
};

const HORARIOS = Array.from({ length: 30 }, (_, i) => {
  const min = 9 * 60 + i * 30;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
});

const construirEsquema = (maxDias: number) =>
  z.object({
    fecha: z
      .string()
      .min(1, 'Selecciona una fecha para la visita')
      .refine((v) => v > hoyISO(), {
        message: 'La fecha de visita debe ser un día futuro',
      })
      .refine((v) => v <= hoyMasDiasISO(maxDias), {
        message: `La visita debe programarse dentro de los próximos ${maxDias} días`,
      }),
    hora: z.string().min(1, 'Indica una hora para la visita'),
  });

type FormularioVisita = { fecha: string; hora: string };

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

const claseIndicadorPicker =
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:top-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-12 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

export const ProgramarVisitaDialog = ({
  reservaId,
  maxDias,
  abierto,
  onAbiertoChange,
  onResuelto,
}: Props) => {
  const mutation = useProgramarVisita();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormularioVisita>({
    resolver: zodResolver(construirEsquema(maxDias)),
    defaultValues: { fecha: '', hora: '' },
  });

  const fechaSeleccionada = watch('fecha');

  // `mutation.reset` es una referencia estable en TanStack Query v5; el objeto
  // `mutation` completo NO lo es (se recrea en cada render), por lo que NO debe
  // entrar en las deps del efecto (provocaría un bucle de render infinito).
  const { reset: resetMutation } = mutation;

  // Al cerrar el diálogo se resetea su estado interno para no arrastrar valores/errores.
  useEffect(() => {
    if (!abierto) {
      resetMutation();
      reset({ fecha: '', hora: '' });
    }
  }, [abierto, resetMutation, reset]);

  const manejarError = (err: ProgramarVisitaError) => {
    if (err.tipo === 'validacion') {
      setError('fecha', { message: err.mensaje });
      return;
    }
    // cola / generico: aviso inline (root) en el formulario.
    setError('root', { message: err.tipo === 'cola' ? err.motivo : err.mensaje });
  };

  const onSubmit = handleSubmit(({ fecha, hora }) => {
    mutation.mutate(
      { id: reservaId, body: { fecha, hora } },
      {
        onSuccess: (reserva) => {
          onResuelto(reserva);
          onAbiertoChange(false);
        },
        onError: manejarError,
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-programar-visita">
        <DialogHeader>
          <DialogTitle>Programar visita al espacio</DialogTitle>
          <DialogDescription>
            Indica la fecha y la hora de la visita. La fecha del evento quedará bloqueada hasta el
            día posterior a la visita y se enviará un email de confirmación al cliente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="programar-visita-fecha" className={claseLabel}>
              Fecha de la visita
            </label>
            <div className="relative">
              <input
                id="programar-visita-fecha"
                type="date"
                min={mananaISO()}
                max={hoyMasDiasISO(maxDias)}
                aria-invalid={errors.fecha ? 'true' : undefined}
                aria-describedby={errors.fecha ? 'programar-visita-fecha-error' : undefined}
                {...register('fecha')}
                className={cn(
                  claseInput,
                  'appearance-none pr-12 [color-scheme:light]',
                  claseIndicadorPicker,
                  !fechaSeleccionada && 'text-text-secondary/60',
                )}
              />
              <CalendarClock
                aria-hidden
                className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
              />
            </div>
            {errors.fecha && (
              <p
                id="programar-visita-fecha-error"
                role="alert"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.fecha.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="programar-visita-hora" className={claseLabel}>
              Hora de la visita
            </label>
            <div className="relative">
              <select
                id="programar-visita-hora"
                aria-invalid={errors.hora ? 'true' : undefined}
                aria-describedby={errors.hora ? 'programar-visita-hora-error' : undefined}
                {...register('hora')}
                className={cn(
                  claseInput,
                  'appearance-none pr-12',
                  !watch('hora') && 'text-text-secondary/40',
                )}
              >
                <option value="">Selecciona una hora</option>
                {HORARIOS.map((hora) => (
                  <option key={hora} value={hora} className="text-text-primary">
                    {hora}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
              />
            </div>
            {errors.hora && (
              <p
                id="programar-visita-hora-error"
                role="alert"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.hora.message}
              </p>
            )}
          </div>

          {errors.root && (
            <div
              role="alert"
              data-testid="aviso-error-programar-visita"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">{errors.root.message}</p>
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
              type="submit"
              disabled={mutation.isPending}
              data-testid="confirmar-programar-visita"
              className={claseBotonPrimario}
            >
              <CalendarClock aria-hidden className="size-5" />
              {mutation.isPending ? 'Programando…' : 'Programar visita'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
