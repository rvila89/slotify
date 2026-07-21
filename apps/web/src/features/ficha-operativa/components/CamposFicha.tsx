import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { CAMPOS_FICHA } from '../lib/campos';
import type { FormularioFicha } from '../lib/schema';

type Props = {
  register: UseFormRegister<FormularioFicha>;
  errors: FieldErrors<FormularioFicha>;
};

const claseInput =
  'h-12 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseArea =
  'min-h-24 w-full rounded-[12px] border border-border-default/30 bg-canvas p-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const tipoInput = (tipo: 'numero' | 'texto' | 'area' | 'email' | 'hora'): string => {
  if (tipo === 'numero') return 'number';
  if (tipo === 'email') return 'email';
  if (tipo === 'hora') return 'time';
  return 'text';
};

const modoEntrada = (
  tipo: 'numero' | 'texto' | 'area' | 'email' | 'hora',
): 'numeric' | 'email' | undefined => {
  if (tipo === 'numero') return 'numeric';
  if (tipo === 'email') return 'email';
  return undefined;
};

/**
 * Rejilla de los campos de la ficha operativa (US-025). Mobile-first: una columna
 * en móvil, dos columnas en `sm:`; los campos de texto largo ocupan ancho completo.
 * Los inputs se registran contra el RHF del formulario padre (fuente de verdad del
 * estado). Sin overflow horizontal; objetivos táctiles ≥ 48px (`h-12`).
 */
export const CamposFicha = ({ register, errors }: Props) => (
  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
    {CAMPOS_FICHA.map(({ campo, etiqueta, tipo, placeholder, anchoCompleto }) => {
      const idCampo = `ficha-${campo}`;
      const error = errors[campo];
      return (
        <div
          key={campo}
          className={cn('flex flex-col gap-2', anchoCompleto && 'sm:col-span-2')}
        >
          <label htmlFor={idCampo} className={claseLabel}>
            {etiqueta}
          </label>
          {tipo === 'area' ? (
            <textarea
              id={idCampo}
              placeholder={placeholder}
              {...register(campo)}
              className={claseArea}
            />
          ) : (
            <input
              id={idCampo}
              type={tipoInput(tipo)}
              inputMode={modoEntrada(tipo)}
              min={tipo === 'numero' ? 0 : undefined}
              step={tipo === 'numero' ? 1 : undefined}
              placeholder={placeholder}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? `${idCampo}-error` : undefined}
              {...register(campo)}
              className={claseInput}
            />
          )}
          {error && (
            <p
              id={`${idCampo}-error`}
              role="alert"
              className="px-1 font-body text-[13px] text-red-600"
            >
              {error.message}
            </p>
          )}
        </div>
      );
    })}
  </div>
);
