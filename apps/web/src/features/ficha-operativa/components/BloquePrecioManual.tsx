import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { cn } from '@/lib/utils';
import type { FormularioFicha } from '../lib/schema';

type Props = {
  register: UseFormRegister<FormularioFicha>;
  errors: FieldErrors<FormularioFicha>;
};

const claseInput =
  'h-12 w-full rounded-[12px] border border-amber-300 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500 sm:max-w-xs';

/**
 * Bloque de PRECIO MANUAL que aparece cuando el recálculo devuelve
 * `tarifaAConsultar=true` (aforo > 50 o sin TARIFA configurada): el motor no resuelve
 * la tarifa y el gestor debe introducir el precio total (IVA incluido) y reenviar el
 * formulario. Mobile-first: input a ancho completo en móvil, acotado en `sm:`.
 */
export const BloquePrecioManual = ({ register, errors }: Props) => (
  <div
    role="group"
    data-testid="bloque-precio-manual"
    className="flex flex-col gap-2 rounded-[16px] border border-amber-200 bg-amber-50 p-4"
  >
    <label
      htmlFor="ficha-precioManualEur"
      className="px-1 font-body text-sm font-medium text-amber-900"
    >
      Precio total manual (IVA incluido)
    </label>
    <p className="px-1 font-body text-[13px] text-amber-800/90">
      Este aforo no tiene tarifa automática. Introduce el precio total del evento y guarda de
      nuevo para aplicar el recálculo.
    </p>
    <input
      id="ficha-precioManualEur"
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      placeholder="Ej. 4500.00"
      aria-invalid={errors.precioManualEur ? 'true' : undefined}
      aria-describedby={errors.precioManualEur ? 'ficha-precioManualEur-error' : undefined}
      data-testid="input-precio-manual"
      {...register('precioManualEur')}
      className={cn(claseInput)}
    />
    {errors.precioManualEur && (
      <p
        id="ficha-precioManualEur-error"
        role="alert"
        className="px-1 font-body text-[13px] text-red-600"
      >
        {errors.precioManualEur.message}
      </p>
    )}
  </div>
);
