import { useFormContext } from 'react-hook-form';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Campo } from './Campo';
import { SeccionHeader } from './SeccionHeader';
import { claseInput, claseLabel, claseSeccion } from '../styles';
import { DURACIONES, TIPOS } from '../constants';
import { mananaISO } from '../../../lib/fecha';
import type { FormularioConsulta } from '../schema';

const HORARIOS = Array.from({ length: 30 }, (_, i) => {
  const min = 9 * 60 + i * 30;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
});

/** Sección 2 del alta — detalles del evento (opcionales; fecha opcional US-004). */
export const SeccionEvento = () => {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<FormularioConsulta>();
  const tipoSeleccionado = watch('tipoEvento');
  const duracionSeleccionada = watch('duracionHoras');
  const fechaSeleccionada = watch('fechaEvento');

  return (
    <section className={claseSeccion} aria-labelledby="seccion-evento">
      <div id="seccion-evento">
        <SeccionHeader numero={2} titulo="Detalles del evento" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <Campo id="fechaEvento" label="Fecha del evento" opcional error={errors.fechaEvento?.message}>
          <div className="relative">
            <input
              id="fechaEvento"
              type="date"
              min={mananaISO()}
              aria-invalid={errors.fechaEvento ? 'true' : undefined}
              aria-describedby={errors.fechaEvento ? 'fechaEvento-error' : 'fechaEvento-hint'}
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
        </Campo>

        <Campo id="invitados" label="Invitados" opcional error={errors.invitados?.message}>
          <input
            id="invitados"
            type="text"
            inputMode="numeric"
            placeholder="Ej. 50"
            aria-invalid={errors.invitados ? 'true' : undefined}
            aria-describedby={errors.invitados ? 'invitados-error' : undefined}
            {...register('invitados')}
            className={claseInput}
          />
        </Campo>

        <Campo id="tipoEvento" label="Tipo de evento" opcional className="sm:col-span-2">
          <div className="relative">
            <select
              id="tipoEvento"
              {...register('tipoEvento')}
              className={cn(
                claseInput,
                'appearance-none pr-12',
                !tipoSeleccionado && 'text-text-secondary/40',
              )}
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
        </Campo>

        <p
          id="fechaEvento-hint"
          className="px-1 font-body text-[13px] text-text-muted sm:col-span-2"
        >
          Solo se admiten fechas posteriores a hoy. Déjala vacía para crear una consulta
          exploratoria sin fecha asignada.
        </p>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className={claseLabel}>
            Horas de duración
            <span className="ml-1 font-normal text-text-muted">(opcional)</span>
          </span>
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
                    // Al quitar la duración, el horario deja de ser válido: se limpia.
                    if (nueva === '') {
                      setValue('horario', '', { shouldDirty: true, shouldValidate: true });
                    }
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

        <Campo
          id="horario"
          label="Hora de inicio"
          opcional
          error={errors.horario?.message}
          className="sm:col-span-2 sm:max-w-md"
        >
          <div className="relative">
            <select
              id="horario"
              disabled={!duracionSeleccionada}
              aria-invalid={errors.horario ? 'true' : undefined}
              aria-describedby={errors.horario ? 'horario-error' : 'horario-hint'}
              {...register('horario')}
              className={cn(
                claseInput,
                'appearance-none pr-12',
                !duracionSeleccionada && 'cursor-not-allowed opacity-50',
                !watch('horario') && 'text-text-secondary/40',
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
          <p id="horario-hint" className="px-1 font-body text-[13px] text-text-muted">
            Solo si ya sabes la hora de inicio del evento. Requiere seleccionar la duración.
          </p>
        </Campo>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="comentarios" className={claseLabel}>
            Comentarios y requisitos
            <span className="ml-1 font-normal text-text-muted">(opcional)</span>
          </label>
          <textarea
            id="comentarios"
            rows={4}
            placeholder="Notas del gestor sobre el lead…"
            {...register('comentarios')}
            className={cn(claseInput, 'h-auto min-h-[120px] resize-y py-3')}
          />
          {errors.comentarios?.message ? (
            <p role="alert" className="px-1 font-body text-[13px] text-red-600">
              {errors.comentarios.message}
            </p>
          ) : (
            <p className="px-1 font-body text-[13px] text-text-muted">
              Si añades comentarios, el email de respuesta inicial (E1) quedará en borrador para tu
              revisión y no se enviará automáticamente.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
