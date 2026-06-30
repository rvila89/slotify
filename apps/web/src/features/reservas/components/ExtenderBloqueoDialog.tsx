import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CalendarClock, Timer } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatearFechaHora } from '../lib/fecha';
import { useExtenderBloqueo, type ExtenderBloqueoError } from '../api/useExtenderBloqueo';
import type { Reserva } from '../model/types';

/**
 * Diálogo del override manual "Extender bloqueo" (US-006 · UC-05). Dispara la
 * prórroga pura del TTL de un bloqueo blando vigente contra el SDK generado
 * (`POST /reservas/{id}/extender-bloqueo`, body `{ dias }`): suma N días al
 * `ttlExpiracion` actual de la RESERVA (y de su FECHA_BLOQUEADA blanda), sin tocar
 * estado/sub_estado/tipo_bloqueo/fecha y sin enviar email al cliente.
 *
 * Diseño: NO existe un frame propio de "ficha de consulta" ni de este diálogo en el
 * archivo Figma "Slotify" (el mapeo frame→US solo cubre el listado de Reservas
 * `0:523`/US-042). Se ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`),
 * reutilizando el mismo tratamiento que `ProgramarVisitaDialog`/`AnadirFechaDialog`:
 * superficie `bg-canvas`, bordes `border-default`, inputs `rounded-[12px]`,
 * tipografía Epilogue (display) + Manrope (body). El `Dialog` (shadcn/Radix) ya es
 * mobile-first (`w-[calc(100%-2rem)]` con margen lateral en móvil, `max-w-lg` en
 * pantallas mayores), sin overflow horizontal; objetivos táctiles ≥ 48px (`h-12`).
 *
 * Validación cliente coherente con el servidor (defensivo, fuente de verdad):
 *  - `dias` ENTERO ≥ 1 (rechaza 0, negativo y no entero) con el mensaje exacto del
 *    contrato. El servidor revalida (422 dias inválido / guarda de estado).
 *
 * Flujo:
 *  - 200: éxito → `onResuelto(reserva)` (la ficha muestra el aviso del nuevo TTL) y cierra.
 *  - 409 `conflicto`: aviso inline con `motivo` (expirado / firme / sin fila blanda).
 *  - 422 `validacion`: mensaje del servidor en el campo de días.
 *  - genérico: aviso de reintento.
 */
type Props = {
  reservaId: string;
  /** TTL actual del bloqueo, para mostrar al gestor sobre qué fecha se extiende. */
  ttlActual?: string | null;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA actualizada (nuevo `ttlExpiracion`) tras un 200. */
  onResuelto: (reserva: Reserva) => void;
};

const MENSAJE_DIAS_INVALIDO =
  'El número de días de extensión debe ser un entero positivo (≥ 1)';

const esquema = z.object({
  dias: z
    .number({ invalid_type_error: MENSAJE_DIAS_INVALIDO })
    .int(MENSAJE_DIAS_INVALIDO)
    .min(1, MENSAJE_DIAS_INVALIDO),
});

type FormularioExtension = { dias: number };

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const ExtenderBloqueoDialog = ({
  reservaId,
  ttlActual,
  abierto,
  onAbiertoChange,
  onResuelto,
}: Props) => {
  const mutation = useExtenderBloqueo();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormularioExtension>({
    resolver: zodResolver(esquema),
    defaultValues: { dias: 7 },
  });

  // `mutation.reset` es referencia estable en TanStack Query v5; el objeto completo
  // no lo es y NO debe entrar en deps (provocaría un bucle de render).
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) {
      resetMutation();
      reset({ dias: 7 });
    }
  }, [abierto, resetMutation, reset]);

  const manejarError = (err: ExtenderBloqueoError) => {
    if (err.tipo === 'validacion') {
      setError('dias', { message: err.mensaje });
      return;
    }
    // conflicto / generico: aviso inline (root) en el formulario.
    setError('root', { message: err.tipo === 'conflicto' ? err.motivo : err.mensaje });
  };

  const onSubmit = handleSubmit(({ dias }) => {
    mutation.mutate(
      { id: reservaId, body: { dias } },
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
      <DialogContent data-testid="dialog-extender-bloqueo">
        <DialogHeader>
          <DialogTitle>Extender bloqueo de fecha</DialogTitle>
          <DialogDescription>
            Indica cuántos días quieres ampliar el bloqueo. Se sumarán al plazo actual sin liberar
            la fecha ni avisar al cliente.
            {ttlActual ? (
              <>
                {' '}
                El bloqueo vence ahora el <strong>{formatearFechaHora(ttlActual)}</strong>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="extender-bloqueo-dias" className={claseLabel}>
              Días de extensión
            </label>
            <div className="relative">
              <input
                id="extender-bloqueo-dias"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                aria-invalid={errors.dias ? 'true' : undefined}
                aria-describedby={errors.dias ? 'extender-bloqueo-dias-error' : undefined}
                {...register('dias', { valueAsNumber: true })}
                className={cn(claseInput, 'pr-12')}
              />
              <Timer
                aria-hidden
                className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
              />
            </div>
            {errors.dias && (
              <p
                id="extender-bloqueo-dias-error"
                role="alert"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.dias.message}
              </p>
            )}
          </div>

          {errors.root && (
            <div
              role="alert"
              data-testid="aviso-error-extender-bloqueo"
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
              data-testid="confirmar-extender-bloqueo"
              className={claseBotonPrimario}
            >
              <CalendarClock aria-hidden className="size-5" />
              {mutation.isPending ? 'Extendiendo…' : 'Extender bloqueo'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
