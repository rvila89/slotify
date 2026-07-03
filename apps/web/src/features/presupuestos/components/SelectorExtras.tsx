import { formatearEuros } from '../lib/dinero';
import type { Extra } from '../model/types';

/**
 * Selector de extras del borrador de presupuesto (US-014 §5.2). Lista el catálogo
 * del tenant con un control de cantidad por extra; las cantidades > 0 se envían al
 * motor de tarifa (via `PresupuestoExtraInput[]`) para sumar subtotales. Componente
 * controlado: recibe el mapa `cantidades` (extraId → cantidad) y notifica cambios.
 *
 * Mobile-first: cada fila es `flex-col` en móvil y `flex-row` desde `sm:`; el input
 * de cantidad es estrecho (`w-20`) y no rompe el layout en 390px.
 */
type Props = {
  extras: Extra[];
  cantidades: Record<string, number>;
  onCambiar: (extraId: string, cantidad: number) => void;
  deshabilitado?: boolean;
};

const claseCantidad =
  'h-11 w-20 rounded-[10px] border border-border-default/30 bg-canvas px-3 text-center font-body text-sm text-text-primary outline-none ring-1 ring-transparent transition focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-60';

export const SelectorExtras = ({ extras, cantidades, onCambiar, deshabilitado }: Props) => {
  if (extras.length === 0) {
    return (
      <p className="font-body text-sm text-text-secondary">
        No hay extras en el catálogo del tenant.
      </p>
    );
  }

  return (
    <ul data-testid="selector-extras" className="flex flex-col gap-3">
      {extras.map((extra) => {
        const id = extra.idExtra ?? '';
        const inputId = `extra-${id}`;
        return (
          <li
            key={id}
            className="flex flex-col gap-2 rounded-[12px] border border-border-default/20 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex flex-col">
              <label htmlFor={inputId} className="font-body text-sm font-medium text-text-primary">
                {extra.nombre}
              </label>
              <span className="font-body text-xs text-text-secondary">
                {formatearEuros(extra.precioUnitario)} / ud.
              </span>
            </div>
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              disabled={deshabilitado}
              value={cantidades[id] ?? 0}
              onChange={(e) => onCambiar(id, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
              className={claseCantidad}
            />
          </li>
        );
      })}
    </ul>
  );
};
