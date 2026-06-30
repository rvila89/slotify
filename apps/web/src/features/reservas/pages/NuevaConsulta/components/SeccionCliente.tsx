import { useFormContext } from 'react-hook-form';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Campo } from './Campo';
import { SeccionHeader } from './SeccionHeader';
import { claseInput, claseSeccion } from '../styles';
import { CANALES } from '../constants';
import type { FormularioConsulta } from '../schema';

/** Sección 1 del alta — datos del cliente (todos obligatorios por contrato). */
export const SeccionCliente = () => {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<FormularioConsulta>();
  const canalSeleccionado = watch('canalEntrada');

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
      </div>
    </section>
  );
};
