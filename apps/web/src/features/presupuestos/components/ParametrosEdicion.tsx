import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { claseInput, claseLabel } from '../lib/estilos';
import { DURACIONES_HORAS, etiquetaDuracion } from '../lib/edicion';
import type { FormularioEdicion } from '../lib/edicionSchema';

/**
 * Campos de parámetros de la edición del presupuesto (US-015 §Campos editables): nº
 * de invitados y duración del evento. Ambos, al cambiar de tramo, recalculan la
 * tarifa vía motor US-016 (el diálogo relanza el preview en vivo). El descuento, el
 * método de pago y los extras viven en el propio diálogo por reutilizar sus
 * componentes/selectores existentes.
 *
 * Mobile-first: los dos campos apilan en columna en móvil y pasan a rejilla de dos
 * columnas desde `sm:`; sin overflow horizontal y con objetivos táctiles ≥ 44px.
 */
type Props = {
  register: UseFormRegister<FormularioEdicion>;
  errors: FieldErrors<FormularioEdicion>;
  deshabilitado?: boolean;
};

export const ParametrosEdicion = ({ register, errors, deshabilitado }: Props) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div className="flex flex-col gap-2">
      <label htmlFor="edicion-num-invitados" className={claseLabel}>
        Nº de invitados (adultos y niños &gt; 4 años)
      </label>
      <input
        id="edicion-num-invitados"
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        disabled={deshabilitado}
        aria-invalid={errors.numInvitados ? 'true' : undefined}
        aria-describedby={errors.numInvitados ? 'edicion-num-invitados-error' : undefined}
        data-testid="input-num-invitados"
        {...register('numInvitados')}
        className={claseInput}
      />
      {errors.numInvitados && (
        <p
          id="edicion-num-invitados-error"
          role="alert"
          className="px-1 font-body text-[13px] text-red-600"
        >
          {errors.numInvitados.message}
        </p>
      )}
    </div>

    <div className="flex flex-col gap-2">
      <label htmlFor="edicion-duracion" className={claseLabel}>
        Duración del evento
      </label>
      <select
        id="edicion-duracion"
        disabled={deshabilitado}
        data-testid="select-duracion"
        {...register('duracionHoras')}
        className={`${claseInput} appearance-none`}
      >
        {DURACIONES_HORAS.map((horas) => (
          <option key={horas} value={horas}>
            {etiquetaDuracion(horas)}
          </option>
        ))}
      </select>
    </div>
  </div>
);
