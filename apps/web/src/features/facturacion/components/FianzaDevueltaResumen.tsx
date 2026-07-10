import { CheckCircle2, Info, RotateCcw, ShieldOff } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import { formatearFecha } from '../lib/fecha';
import type { FianzaStatus } from '../model/types';

/**
 * Resumen del **estado final de la devolución de fianza** (US-036 · D-7). Se muestra cuando
 * `fianzaStatus ∈ {devuelta, retenida_parcial}`: la acción de registro se oculta y en su lugar se
 * informa del importe devuelto (`fianzaDevueltaEur`), la fecha (`fianzaDevueltaFecha`), el estado
 * final y —si es parcial— el `motivoRetencion`. Presentacional puro; los tonos usan tokens del
 * proyecto (verde para `devuelta`, ámbar para `retenida_parcial`). Mobile-first: los datos apilan
 * en `<sm` y pasan a dos columnas en `sm:`.
 *
 * FA-04: cuando la devolución se registró sin justificante (`avisoSinJustificante`), el aviso se
 * muestra **de forma persistente dentro del resumen final** (no efímero). El resumen es el estado
 * estable al que transiciona la tarjeta tras invalidar la query de la reserva, por lo que el aviso
 * sobrevive al cambio de `fianzaStatus` a `devuelta`/`retenida_parcial`.
 */
type Props = {
  /** Estado final de la fianza tras la devolución. */
  fianzaStatus: FianzaStatus;
  /** Importe devuelto (`RESERVA.fianzaDevueltaEur`, `Importe` string decimal). */
  fianzaDevueltaEur?: string | null;
  /** Fecha de la devolución (`RESERVA.fianzaDevueltaFecha`, `YYYY-MM-DD`). */
  fianzaDevueltaFecha?: string | null;
  /** Motivo de la retención (solo en `retenida_parcial`). */
  motivoRetencion?: string | null;
  /** FA-04: la devolución se registró sin justificante (aviso persistente para adjuntarlo luego). */
  avisoSinJustificante?: boolean;
};

export const FianzaDevueltaResumen = ({
  fianzaStatus,
  fianzaDevueltaEur,
  fianzaDevueltaFecha,
  motivoRetencion,
  avisoSinJustificante = false,
}: Props) => {
  const esParcial = fianzaStatus === 'retenida_parcial';
  const marco = esParcial ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
  const textoCabecera = esParcial ? 'text-amber-900' : 'text-emerald-900';
  const iconoCabecera = esParcial ? 'text-amber-600' : 'text-emerald-600';
  const textoImporte = esParcial ? 'text-amber-700' : 'text-emerald-700';

  return (
    <div
      data-testid="fianza-devuelta-resumen"
      data-fianza-status={fianzaStatus}
      className={`flex flex-col gap-4 rounded-[16px] border p-4 sm:p-5 ${marco}`}
    >
      <p role="status" className={`flex items-start gap-3 font-body text-sm ${textoCabecera}`}>
        {esParcial ? (
          <ShieldOff aria-hidden className={`mt-0.5 size-5 shrink-0 ${iconoCabecera}`} />
        ) : (
          <RotateCcw aria-hidden className={`mt-0.5 size-5 shrink-0 ${iconoCabecera}`} />
        )}
        <span>
          <strong className="font-semibold">
            {esParcial ? 'Devolución parcial registrada.' : 'Fianza devuelta.'}
          </strong>{' '}
          {esParcial
            ? 'Se ha devuelto una parte de la fianza y se ha retenido el resto.'
            : 'La devolución ha quedado registrada.'}
        </span>
      </p>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="font-body text-xs text-text-secondary">Importe devuelto</dt>
          <dd
            data-testid="fianza-devuelta-importe"
            className={`font-display text-base font-bold ${textoImporte}`}
          >
            {formatearEuros(fianzaDevueltaEur)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="font-body text-xs text-text-secondary">Fecha de la devolución</dt>
          <dd
            data-testid="fianza-devuelta-fecha"
            className="flex items-center gap-2 font-display text-base font-semibold text-text-primary"
          >
            <CheckCircle2 aria-hidden className={`size-4 shrink-0 ${iconoCabecera}`} />
            {formatearFecha(fianzaDevueltaFecha)}
          </dd>
        </div>
      </dl>

      {esParcial && motivoRetencion && (
        <div className="flex flex-col gap-1 rounded-[12px] bg-canvas/60 p-3">
          <dt className="font-body text-xs text-text-secondary">Motivo de la retención</dt>
          <dd
            data-testid="fianza-devuelta-motivo"
            className="font-body text-sm text-text-primary"
          >
            {motivoRetencion}
          </dd>
        </div>
      )}

      {avisoSinJustificante && (
        <p
          role="status"
          data-testid="aviso-sin-justificante"
          className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-3 font-body text-sm text-amber-900"
        >
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          Devolución registrada sin justificante. Puedes adjuntarlo más tarde desde la ficha de
          documentos de la reserva.
        </p>
      )}
    </div>
  );
};
