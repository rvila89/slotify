import { formatearEuros } from '../lib/dinero';
import type { DesgloseFiscal, RepartoPago } from '../model/types';

/**
 * Desglose fiscal + reparto de pago del borrador de presupuesto (US-014 §5.2).
 * Muestra base imponible, IVA 21%, extras, descuento y total, y debajo el reparto
 * 40% señal / 60% liquidación + fianza. Componente de presentación puro (no toca
 * la API): recibe el `desglose` y el `reparto` del `PresupuestoPreviewResponse`.
 *
 * Mobile-first: las filas son `flex` con `justify-between` que no rompen en 390px;
 * el importe queda a la derecha con `tabular-nums` para alineación de dígitos.
 */
type Props = {
  desglose: DesgloseFiscal;
  reparto?: RepartoPago | null;
  extrasTotalEur?: string | null;
  descuentoEur?: string | null;
};

const claseFila = 'flex items-baseline justify-between gap-4 font-body text-sm';
const claseImporte = 'shrink-0 tabular-nums text-text-primary';

export const DesglosePresupuesto = ({
  desglose,
  reparto,
  extrasTotalEur,
  descuentoEur,
}: Props) => (
  <div data-testid="desglose-presupuesto" className="flex flex-col gap-4">
    <div className="flex flex-col gap-2 rounded-[16px] border border-border-default/20 bg-surface-subtle/40 p-4">
      <div className={claseFila}>
        <span className="text-text-secondary">Base imponible</span>
        <span className={claseImporte}>{formatearEuros(desglose.baseImponible)}</span>
      </div>
      <div className={claseFila}>
        <span className="text-text-secondary">IVA ({desglose.ivaPorcentaje}%)</span>
        <span className={claseImporte}>{formatearEuros(desglose.ivaImporte)}</span>
      </div>
      {extrasTotalEur && Number(extrasTotalEur) > 0 && (
        <div className={claseFila}>
          <span className="text-text-secondary">Extras (incluidos en el total)</span>
          <span className={claseImporte}>{formatearEuros(extrasTotalEur)}</span>
        </div>
      )}
      {descuentoEur && Number(descuentoEur) > 0 && (
        <div className={claseFila}>
          <span className="text-text-secondary">Descuento aplicado</span>
          <span className={claseImporte}>−{formatearEuros(descuentoEur)}</span>
        </div>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border-default/20 pt-3 font-display text-base font-bold">
        <span className="text-text-primary">Total (IVA incluido)</span>
        <span data-testid="desglose-total" className="shrink-0 tabular-nums text-brand-primary">
          {formatearEuros(desglose.total)}
        </span>
      </div>
    </div>

    {reparto && (
      <div className="flex flex-col gap-2 rounded-[16px] border border-border-default/20 p-4">
        <h4 className="font-body text-xs font-bold uppercase tracking-[1.2px] text-text-secondary">
          Reparto de pago
        </h4>
        <div className={claseFila}>
          <span className="text-text-secondary">Señal (40%)</span>
          <span className={claseImporte}>{formatearEuros(reparto.senalEur)}</span>
        </div>
        <div className={claseFila}>
          <span className="text-text-secondary">Liquidación (60%)</span>
          <span className={claseImporte}>{formatearEuros(reparto.liquidacionEur)}</span>
        </div>
        <div className={claseFila}>
          <span className="text-text-secondary">Fianza (fuera del total)</span>
          <span className={claseImporte}>{formatearEuros(reparto.fianzaEur)}</span>
        </div>
      </div>
    )}
  </div>
);
