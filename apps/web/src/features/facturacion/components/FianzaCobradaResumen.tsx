import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import { formatearFecha } from '../lib/fecha';

/**
 * Resumen del **estado cobrado de la fianza** (US-030 · D-4). Se muestra cuando
 * `fianzaStatus='cobrada'`: la acción de cobro se oculta y en su lugar se informa del importe
 * (`fianzaEur`) y la fecha (`fianzaCobradaFecha`) del cobro registrado. Presentacional puro;
 * los tonos de éxito usan tokens verdes del proyecto. Mobile-first: los datos apilan en `<sm`.
 */
type Props = {
  /** Importe cobrado (`RESERVA.fianzaEur`, `Importe` string decimal). */
  fianzaEur?: string | null;
  /** Fecha del cobro (`RESERVA.fianzaCobradaFecha`, `YYYY-MM-DD`). */
  fianzaCobradaFecha?: string | null;
};

export const FianzaCobradaResumen = ({ fianzaEur, fianzaCobradaFecha }: Props) => (
  <div
    data-testid="fianza-cobrada-resumen"
    className="flex flex-col gap-4 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 sm:p-5"
  >
    <p role="status" className="flex items-start gap-3 font-body text-sm text-emerald-900">
      <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <span>
        <strong className="font-semibold">Fianza cobrada.</strong> El cobro ha quedado registrado.
      </span>
    </p>

    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Importe cobrado</dt>
        <dd data-testid="fianza-cobrada-importe" className="font-display text-base font-bold text-emerald-700">
          {formatearEuros(fianzaEur)}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Fecha del cobro</dt>
        <dd
          data-testid="fianza-cobrada-fecha"
          className="flex items-center gap-2 font-display text-base font-semibold text-text-primary"
        >
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600" />
          {formatearFecha(fianzaCobradaFecha)}
        </dd>
      </div>
    </dl>
  </div>
);
