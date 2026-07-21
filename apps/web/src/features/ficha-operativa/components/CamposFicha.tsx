import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { CAMPOS_TEXTO_FICHA, DURACIONES_HORAS, etiquetaDuracion } from '../lib/campos';
import type { FormularioFicha } from '../lib/schema';

type Props = {
  register: UseFormRegister<FormularioFicha>;
  errors: FieldErrors<FormularioFicha>;
  /** Nº de personas DERIVADO (adultos ≥4 + niños <4), read-only. */
  numPersonas: number;
};

const claseInput =
  'h-12 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

const claseArea =
  'min-h-24 w-full rounded-[12px] border border-border-default/30 bg-canvas p-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const tipoInput = (tipo: 'texto' | 'area' | 'email' | 'hora'): string => {
  if (tipo === 'email') return 'email';
  if (tipo === 'hora') return 'time';
  return 'text';
};

const modoEntrada = (tipo: 'texto' | 'area' | 'email' | 'hora'): 'email' | undefined =>
  tipo === 'email' ? 'email' : undefined;

const MensajeError = ({ id, mensaje }: { id: string; mensaje?: string }) =>
  mensaje ? (
    <p id={id} role="alert" className="px-1 font-body text-[13px] text-red-600">
      {mensaje}
    </p>
  ) : null;

/**
 * Rejilla de los campos de la ficha operativa (US-025 · [reserva-viva]). Mobile-first:
 * una columna en móvil, dos columnas en `md:`; sin overflow horizontal; objetivos
 * táctiles ≥ 48px (`h-12`).
 *
 * Bloque de AFORO ESTRUCTURAL: desglose de invitados (adultos y niños ≥4 / niños <4,
 * apilados en `<md` y en fila en `md:`), nº de personas total DERIVADO (read-only) y
 * duración enum `{4,8,12}`. El resto son campos de texto libre declarados en
 * `CAMPOS_TEXTO_FICHA` (contacto, hora, notas, briefing).
 */
export const CamposFicha = ({ register, errors, numPersonas }: Props) => (
  <div className="flex flex-col gap-6">
    <fieldset className="flex flex-col gap-4 rounded-[16px] border border-border-default/20 bg-canvas/40 p-4">
      <legend className="px-1 font-body text-xs font-bold uppercase tracking-[1px] text-text-secondary">
        Aforo y duración
      </legend>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="ficha-numAdultosNinosMayores4" className={claseLabel}>
            Adultos y niños ≥ 4 años
          </label>
          <input
            id="ficha-numAdultosNinosMayores4"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Ej. 85"
            aria-invalid={errors.numAdultosNinosMayores4 ? 'true' : undefined}
            aria-describedby={
              errors.numAdultosNinosMayores4 ? 'ficha-numAdultosNinosMayores4-error' : undefined
            }
            data-testid="input-adultos-ninos-mayores4"
            {...register('numAdultosNinosMayores4')}
            className={claseInput}
          />
          <MensajeError
            id="ficha-numAdultosNinosMayores4-error"
            mensaje={errors.numAdultosNinosMayores4?.message}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="ficha-numNinosMenores4" className={claseLabel}>
            Niños &lt; 4 años
          </label>
          <input
            id="ficha-numNinosMenores4"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Ej. 5"
            aria-invalid={errors.numNinosMenores4 ? 'true' : undefined}
            aria-describedby={errors.numNinosMenores4 ? 'ficha-numNinosMenores4-error' : undefined}
            data-testid="input-ninos-menores4"
            {...register('numNinosMenores4')}
            className={claseInput}
          />
          <MensajeError
            id="ficha-numNinosMenores4-error"
            mensaje={errors.numNinosMenores4?.message}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="ficha-numPersonas" className={claseLabel}>
            Nº de personas (total)
          </label>
          <output
            id="ficha-numPersonas"
            htmlFor="ficha-numAdultosNinosMayores4 ficha-numNinosMenores4"
            data-testid="num-personas-derivado"
            className={cn(
              claseInput,
              'flex items-center bg-surface-muted/50 font-medium text-text-secondary',
            )}
          >
            {numPersonas}
          </output>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="ficha-duracionHoras" className={claseLabel}>
            Duración del evento
          </label>
          <select
            id="ficha-duracionHoras"
            data-testid="select-duracion-horas"
            {...register('duracionHoras')}
            className={cn(claseInput, 'appearance-none')}
          >
            <option value="">Sin especificar</option>
            {DURACIONES_HORAS.map((horas) => (
              <option key={horas} value={String(horas)}>
                {etiquetaDuracion(horas)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>

    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {CAMPOS_TEXTO_FICHA.map(({ campo, etiqueta, tipo, placeholder, anchoCompleto }) => {
        const idCampo = `ficha-${campo}`;
        const error = errors[campo];
        return (
          <div
            key={campo}
            className={cn('flex flex-col gap-2', anchoCompleto && 'md:col-span-2')}
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
                placeholder={placeholder}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? `${idCampo}-error` : undefined}
                {...register(campo)}
                className={claseInput}
              />
            )}
            <MensajeError id={`${idCampo}-error`} mensaje={error?.message} />
          </div>
        );
      })}
    </div>
  </div>
);
