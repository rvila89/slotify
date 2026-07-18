import { useFormContext } from 'react-hook-form';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Campo } from './Campo';
import { SeccionHeader } from './SeccionHeader';
import { claseInput, claseLabel, claseSeccion } from '../styles';
import { CANALES, IDIOMAS } from '../constants';
import type { FormularioConsulta } from '../schema';

/** Sección 1 del alta — datos del cliente (todos obligatorios por contrato). */
export const SeccionCliente = () => {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<FormularioConsulta>();
  const canalSeleccionado = watch('canalEntrada');
  const idiomaSeleccionado = watch('idioma');

  return (
    <section className={claseSeccion} aria-labelledby="seccion-cliente">
      <div id="seccion-cliente">
        <SeccionHeader numero={1} titulo="Datos del cliente" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <Campo id="nombre" label="Nombre" error={errors.nombre?.message}>
          <input
            id="nombre"
            type="text"
            autoComplete="given-name"
            placeholder="Ej. Javier"
            aria-invalid={errors.nombre ? 'true' : undefined}
            aria-describedby={errors.nombre ? 'nombre-error' : undefined}
            {...register('nombre')}
            className={claseInput}
          />
        </Campo>

        <Campo id="apellidos" label="Apellidos" error={errors.apellidos?.message}>
          <input
            id="apellidos"
            type="text"
            autoComplete="family-name"
            placeholder="Ej. Gómez Ruiz"
            aria-invalid={errors.apellidos ? 'true' : undefined}
            aria-describedby={errors.apellidos ? 'apellidos-error' : undefined}
            {...register('apellidos')}
            className={claseInput}
          />
        </Campo>

        <Campo id="email" label="Email de contacto" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="javier@ejemplo.com"
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
            className={claseInput}
          />
        </Campo>

        <Campo id="telefono" label="Teléfono" error={errors.telefono?.message}>
          <input
            id="telefono"
            type="tel"
            autoComplete="tel"
            placeholder="+34 600 000 000"
            aria-invalid={errors.telefono ? 'true' : undefined}
            aria-describedby={errors.telefono ? 'telefono-error' : undefined}
            {...register('telefono')}
            className={claseInput}
          />
        </Campo>

        <Campo
          id="canalEntrada"
          label="Canal de entrada"
          error={errors.canalEntrada?.message}
          className="sm:col-span-2"
        >
          <div className="relative">
            <select
              id="canalEntrada"
              aria-invalid={errors.canalEntrada ? 'true' : undefined}
              aria-describedby={errors.canalEntrada ? 'canalEntrada-error' : undefined}
              {...register('canalEntrada')}
              className={cn(
                claseInput,
                'appearance-none pr-12',
                !canalSeleccionado && 'text-text-secondary/40',
              )}
            >
              <option value="">Selecciona un canal</option>
              {CANALES.map(({ value, label }) => (
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

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className={claseLabel}>Idioma de comunicación</span>
          <div
            className="grid grid-cols-2 gap-3 sm:max-w-md"
            role="radiogroup"
            aria-label="Idioma de comunicación"
          >
            {IDIOMAS.map(({ value, label }) => {
              const activo = idiomaSeleccionado === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => setValue('idioma', value, { shouldDirty: true })}
                  className={cn(
                    'flex min-h-[44px] items-center justify-center rounded-[12px] border font-body text-base font-medium transition',
                    activo
                      ? 'border-transparent bg-state-confirmada text-[#5b2615]'
                      : 'border-border-default/30 bg-canvas text-text-secondary hover:bg-surface-muted',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
