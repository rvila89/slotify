import { CircleDollarSign, X } from 'lucide-react';
import { formatearEuros } from '../lib/recalculo';
import type { RecalculoResultado } from '../model/types';

type Props = {
  /** Resultado del recálculo devuelto por el PATCH (con tarifa resuelta). */
  recalculo: RecalculoResultado;
  onCerrar: () => void;
};

/**
 * Banner inline (no bloqueante, descartable) que informa del RECÁLCULO en cascada
 * disparado por un cambio de aforo/duración dentro de la ventana viva (US · [reserva-
 * viva]). Solo se muestra cuando el motor resolvió tarifa (`tarifaAConsultar=false`):
 * el nuevo total re-congelado y la liquidación restante. El pago inicial (señal) NO se
 * recalcula. Complementa al toast; sirve de rastro visible en la ficha.
 */
export const AvisoRecalculo = ({ recalculo, onCerrar }: Props) => (
  <div
    role="status"
    data-testid="aviso-recalculo"
    className="flex items-start gap-3 rounded-[16px] border border-sky-200 bg-sky-50 p-4 text-sky-900"
  >
    <CircleDollarSign aria-hidden className="mt-0.5 size-5 shrink-0 text-sky-600" />
    <div className="flex flex-1 flex-col gap-1 font-body text-sm">
      <p className="font-medium">
        Precio actualizado a {formatearEuros(recalculo.nuevoTotal)}.
      </p>
      <p className="text-sky-800/90">
        Pendiente de pago: {formatearEuros(recalculo.liquidacionRestante)} (pago inicial ya
        realizado: {formatearEuros(recalculo.pagoInicial)}). Se ha regenerado el presupuesto
        y el borrador de factura de liquidación.
      </p>
    </div>
    <button
      type="button"
      onClick={onCerrar}
      aria-label="Descartar aviso"
      className="shrink-0 rounded-full p-1 text-sky-700 transition hover:bg-sky-100"
    >
      <X aria-hidden className="size-4" />
    </button>
  </div>
);
