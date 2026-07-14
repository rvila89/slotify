import { claseLabel, claseTarjetaMetodoPago } from '../lib/estilos';
import { OPCIONES_METODO_PAGO } from '../lib/metodoPago';
import type { MetodoPago } from '../model/types';

/**
 * Selector obligatorio de método de pago del presupuesto (6.2 §5.1). El método
 * elegido determina el régimen fiscal del borrador y del presupuesto confirmado
 * (`transferencia ⇒ con IVA`, `efectivo ⇒ sin IVA`). Se implementa como un grupo
 * de radios nativos accesibles (`role="radiogroup"` + `<input type="radio">`)
 * estilizados con los tokens del proyecto; no añade dependencias de UI nuevas.
 *
 * Componente controlado: recibe el `valor` actual y notifica el cambio. El campo
 * es requerido; el diálogo lo integra en RHF + Zod (siempre hay un valor por
 * defecto, así que el error de "elige uno" solo se dispara si se limpiara).
 *
 * Mobile-first: las tarjetas apilan en columna en móvil (`flex-col`) y pasan a
 * fila desde `sm:` (`sm:flex-row`); sin overflow horizontal y con objetivos
 * táctiles ≥ 44px (`min-h`).
 */
type Props = {
  valor: MetodoPago;
  onCambiar: (valor: MetodoPago) => void;
  deshabilitado?: boolean;
};

export const SelectorMetodoPago = ({ valor, onCambiar, deshabilitado }: Props) => (
  <fieldset className="flex flex-col gap-3" disabled={deshabilitado}>
    <legend className={claseLabel}>Método de pago — requerido</legend>
    <div
      role="radiogroup"
      aria-label="Método de pago"
      data-testid="selector-metodo-pago"
      className="flex flex-col gap-3 sm:flex-row"
    >
      {OPCIONES_METODO_PAGO.map((opcion) => {
        const inputId = `metodo-pago-${opcion.valor}`;
        return (
          <label key={opcion.valor} htmlFor={inputId} className={claseTarjetaMetodoPago}>
            <input
              id={inputId}
              type="radio"
              name="metodoPago"
              value={opcion.valor}
              checked={valor === opcion.valor}
              onChange={() => onCambiar(opcion.valor)}
              data-testid={`metodo-pago-${opcion.valor}`}
              className="mt-1 size-4 shrink-0 accent-brand-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-body text-sm font-medium text-text-primary">
                {opcion.titulo}
              </span>
              <span className="font-body text-xs text-text-secondary">{opcion.descripcion}</span>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);
