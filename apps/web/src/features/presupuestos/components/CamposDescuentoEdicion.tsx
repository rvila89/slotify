import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { claseInput, claseLabel } from '../lib/estilos';
import type { FormularioEdicion } from '../lib/edicionSchema';

/**
 * Campos de descuento y precio manual de la edición del presupuesto (US-015 §Campos
 * editables). El descuento (`>= 0`; el server revalida `<= baseImponible` → 422) y su
 * motivo opcional viven aquí; el precio manual solo se muestra cuando el preview
 * devuelve `tarifaAConsultar=true` (>50 invitados) y entonces es obligatorio.
 * Extraído del diálogo para respetar el límite de 300 líneas (regla dura `max-lines`).
 *
 * Mobile-first: descuento y motivo apilan en columna en móvil y pasan a rejilla de
 * dos columnas desde `sm:`; sin overflow horizontal, táctiles ≥ 44px.
 */
type Props = {
  register: UseFormRegister<FormularioEdicion>;
  errors: FieldErrors<FormularioEdicion>;
  tarifaAConsultar: boolean;
  faltaPrecioManual: boolean;
  deshabilitado?: boolean;
};

export const CamposDescuentoEdicion = ({
  register,
  errors,
  tarifaAConsultar,
  faltaPrecioManual,
  deshabilitado,
}: Props) => (
  <>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <label htmlFor="edicion-descuento" className={claseLabel}>
          Descuento (€)
        </label>
        <input
          id="edicion-descuento"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          disabled={deshabilitado}
          aria-invalid={errors.descuento ? 'true' : undefined}
          {...register('descuento')}
          placeholder="0.00"
          data-testid="input-descuento"
          className={claseInput}
        />
        {errors.descuento && (
          <p role="alert" className="px-1 font-body text-[13px] text-red-600">
            {errors.descuento.message}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="edicion-descuento-motivo" className={claseLabel}>
          Motivo del descuento (opcional)
        </label>
        <input
          id="edicion-descuento-motivo"
          type="text"
          disabled={deshabilitado}
          {...register('descuentoMotivo')}
          data-testid="input-descuento-motivo"
          className={claseInput}
        />
      </div>
    </div>

    {tarifaAConsultar && (
      <div className="flex flex-col gap-2">
        <label htmlFor="edicion-precio-manual" className={claseLabel}>
          Precio manual (€, IVA incluido) — requerido
        </label>
        <input
          id="edicion-precio-manual"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          disabled={deshabilitado}
          aria-invalid={errors.precioManual || faltaPrecioManual ? 'true' : undefined}
          {...register('precioManual')}
          placeholder="0.00"
          data-testid="input-precio-manual"
          className={claseInput}
        />
        <p className="px-1 font-body text-[13px] text-text-secondary">
          {errors.precioManual?.message ??
            'Esta edición supera los 50 invitados: la tarifa es a consultar. Introduce el precio total acordado.'}
        </p>
      </div>
    )}
  </>
);
