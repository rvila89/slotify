import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ChevronDown, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { HORARIOS } from '../lib/horarios';
import {
  aUpdateReservaRequest,
  editarConsultaSchema,
  valoresDeReserva,
  type FormularioEditarConsulta,
} from '../lib/editarConsultaSchema';
import { useEditarConsulta, type EditarConsultaError } from '../api/useEditarConsulta';
import { FechaConsultaSeccion } from './FechaConsultaSeccion';
import type { Reserva } from '../model/types';

/**
 * Diálogo "Editar consulta" (US-051 §Punto 2). Edita los CAMPOS SIMPLES de la
 * RESERVA (`tipoEvento`, `duracionHoras`, invitados, `horario`, `notas`) vía
 * `PATCH /reservas/{id}` (SDK generado). La FECHA NUNCA se toca por el PATCH
 * (§D-1): se gestiona por el flujo atómico —`onGestionarFecha` cierra este editor
 * y abre "Añadir fecha" (`2a`) o "Cambiar fecha" (`2b/2c/2v`) según el sub-estado.
 *
 * Diseño: NO existe frame propio en Figma "Slotify" para esta ficha/diálogos; se
 * ADAPTA con los tokens del proyecto reutilizando el tratamiento de
 * `AnadirFechaDialog`/`ProgramarVisitaDialog` (superficie `bg-canvas`, inputs
 * `rounded-[12px]`, Epilogue/Manrope, selectores nativos). El `Dialog` shadcn ya es
 * mobile-first, sin overflow horizontal.
 */
const TIPOS = [
  { value: 'boda', label: 'Boda' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'privado', label: 'Privado' },
  { value: 'cumpleanos', label: 'Cumpleaños' },
  { value: 'otro', label: 'Otro' },
] as const;

const DURACIONES = ['4', '8', '12'] as const;

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

const claseError = 'px-1 font-body text-[13px] text-red-600';

type Props = {
  reservaId: string;
  reserva: Reserva;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca al guardar con éxito (la ficha refresca vía cache/invalidación). */
  onEditado: () => void;
  /** Cierra el editor y abre el flujo atómico de fecha (añadir/cambiar). */
  onGestionarFecha: () => void;
};

export const EditarConsultaDialog = ({
  reservaId,
  reserva,
  abierto,
  onAbiertoChange,
  onEditado,
  onGestionarFecha,
}: Props) => {
  const mutation = useEditarConsulta();
  const { reset: resetMutation } = mutation;

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormularioEditarConsulta>({
    resolver: zodResolver(editarConsultaSchema),
    defaultValues: valoresDeReserva(reserva),
  });

  const duracionSeleccionada = watch('duracionHoras');
  const tipoSeleccionado = watch('tipoEvento');
  const horarioSeleccionado = watch('horario');

  // Al abrir se resincroniza el formulario con la RESERVA vigente; al cerrar se
  // limpia el estado de la mutación para no arrastrar errores entre aperturas.
  useEffect(() => {
    if (abierto) reset(valoresDeReserva(reserva));
    else resetMutation();
  }, [abierto, reserva, reset, resetMutation]);

  const manejarError = (err: EditarConsultaError) => {
    if (err.tipo === 'validacion' && err.campo) {
      setError(err.campo as keyof FormularioEditarConsulta, { message: err.mensaje });
      return;
    }
    setError('root', { message: err.mensaje });
  };

  const onSubmit = handleSubmit((valores) => {
    mutation.mutate(
      { id: reservaId, body: aUpdateReservaRequest(valores) },
      {
        onSuccess: () => {
          onEditado();
          onAbiertoChange(false);
        },
        onError: manejarError,
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-editar-consulta" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar consulta</DialogTitle>
          <DialogDescription>
            Actualiza los datos del evento. La fecha se gestiona aparte (bloqueo de fecha) desde el
            botón de fecha.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="editar-tipo" className={claseLabel}>
              Tipo de evento
            </label>
            <div className="relative">
              <select
                id="editar-tipo"
                {...register('tipoEvento')}
                className={cn(claseInput, 'appearance-none pr-12', !tipoSeleccionado && 'text-text-secondary/40')}
              >
                <option value="">Sin especificar</option>
                {TIPOS.map(({ value, label }) => (
                  <option key={value} value={value} className="text-text-primary">
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={claseLabel}>Horas de duración</span>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Horas de duración">
              {DURACIONES.map((horas) => {
                const activo = duracionSeleccionada === horas;
                return (
                  <button
                    key={horas}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => {
                      const nueva = activo ? '' : horas;
                      setValue('duracionHoras', nueva, { shouldDirty: true });
                      if (nueva === '') setValue('horario', '', { shouldValidate: true });
                    }}
                    className={cn(
                      'flex h-14 items-center justify-center rounded-[12px] border font-body text-base font-medium transition',
                      activo
                        ? 'border-transparent bg-state-confirmada text-[#5b2615]'
                        : 'border-border-default/30 bg-canvas text-text-secondary hover:bg-surface-muted',
                    )}
                  >
                    {horas}h
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="editar-adultos" className={claseLabel}>
                Invitados (adultos y niños &gt; 4)
              </label>
              <input
                id="editar-adultos"
                type="text"
                inputMode="numeric"
                placeholder="Ej. 50"
                aria-invalid={errors.numAdultosNinosMayores4 ? 'true' : undefined}
                {...register('numAdultosNinosMayores4')}
                className={claseInput}
              />
              {errors.numAdultosNinosMayores4 && (
                <p role="alert" className={claseError}>
                  {errors.numAdultosNinosMayores4.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="editar-ninos" className={claseLabel}>
                Niños ≤ 4
              </label>
              <input
                id="editar-ninos"
                type="text"
                inputMode="numeric"
                placeholder="Ej. 5"
                aria-invalid={errors.numNinosMenores4 ? 'true' : undefined}
                {...register('numNinosMenores4')}
                className={claseInput}
              />
              {errors.numNinosMenores4 && (
                <p role="alert" className={claseError}>
                  {errors.numNinosMenores4.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="editar-horario" className={claseLabel}>
              Hora de inicio
            </label>
            <div className="relative">
              <select
                id="editar-horario"
                disabled={!duracionSeleccionada}
                aria-invalid={errors.horario ? 'true' : undefined}
                {...register('horario')}
                className={cn(
                  claseInput,
                  'appearance-none pr-12',
                  !duracionSeleccionada && 'cursor-not-allowed opacity-50',
                  !horarioSeleccionado && 'text-text-secondary/40',
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
            {errors.horario && (
              <p role="alert" className={claseError}>
                {errors.horario.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="editar-notas" className={claseLabel}>
              Comentarios
            </label>
            <textarea
              id="editar-notas"
              rows={4}
              placeholder="Notas internas sobre el lead…"
              {...register('notas')}
              className={cn(claseInput, 'h-auto min-h-[120px] resize-y py-3')}
            />
            {errors.notas && (
              <p role="alert" className={claseError}>
                {errors.notas.message}
              </p>
            )}
          </div>

          <FechaConsultaSeccion reserva={reserva} onGestionarFecha={onGestionarFecha} />

          {errors.root && (
            <div
              role="alert"
              data-testid="aviso-error-editar-consulta"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">{errors.root.message}</p>
            </div>
          )}

          <DialogFooter>
            <button type="button" onClick={() => onAbiertoChange(false)} className={claseBotonSecundario}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              data-testid="confirmar-editar-consulta"
              className={claseBotonPrimario}
            >
              <Pencil aria-hidden className="size-5" />
              {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
