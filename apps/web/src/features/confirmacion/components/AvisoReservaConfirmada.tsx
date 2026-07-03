import { CheckCircle2, FileText, Info, X } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import type { ConfirmarSenalResponse } from '../model/types';

/**
 * Aviso de éxito tras confirmar el pago de la señal (US-021 · UC-17). Confirma que
 * la RESERVA pasó a `reserva_confirmada`, resume el desglose congelado
 * (`importeSenal`/`importeLiquidacion`) y el arranque de los tres sub-procesos en
 * `pendiente`, y presenta/enlaza la factura de señal en borrador para revisión
 * (disparo de US-022).
 *
 * Gestión de `facturaSenalBorrador` (US-022 aún no existe): si el campo VIENE en la
 * respuesta se ofrece el enlace al PDF (si lo hay) o la referencia mínima; si NO
 * viene (`null`/ausente) NO se rompe: se muestra un aviso mínimo de que la factura
 * está en preparación. Componente de presentación puro; mobile-first.
 */
type Props = {
  resultado: ConfirmarSenalResponse;
  onCerrar: () => void;
};

export const AvisoReservaConfirmada = ({ resultado, onCerrar }: Props) => {
  const { reserva, facturaSenalBorrador } = resultado;

  return (
    <div
      role="status"
      data-testid="aviso-reserva-confirmada"
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div className="flex flex-1 flex-col gap-3 font-body text-sm">
        <p className="font-medium">
          Pago de señal confirmado. La reserva ha pasado a <strong>reserva confirmada</strong> y la
          fecha queda bloqueada en firme.
        </p>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col">
            <dt className="text-emerald-700/80">Señal (congelada)</dt>
            <dd className="font-semibold">{formatearEuros(reserva.importeSenal)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-emerald-700/80">Liquidación pendiente</dt>
            <dd className="font-semibold">{formatearEuros(reserva.importeLiquidacion)}</dd>
          </div>
        </dl>

        <p>
          Se han iniciado los sub-procesos de <strong>pre-evento</strong>,{' '}
          <strong>liquidación</strong> y <strong>fianza</strong> (pendientes).
        </p>

        {facturaSenalBorrador ? (
          <div
            data-testid="factura-senal-borrador"
            className="flex flex-col gap-1 rounded-[12px] border border-emerald-200 bg-emerald-100/50 p-3"
          >
            <p className="flex items-center gap-2 font-medium">
              <FileText aria-hidden className="size-4 shrink-0" />
              Factura de señal en borrador lista para revisión
            </p>
            {typeof facturaSenalBorrador.total !== 'undefined' && (
              <p>
                Importe de la factura: <strong>{formatearEuros(facturaSenalBorrador.total)}</strong>
              </p>
            )}
            {facturaSenalBorrador.pdfUrl && (
              <a
                href={facturaSenalBorrador.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="w-fit font-medium text-emerald-700 underline"
              >
                Ver el borrador de la factura
              </a>
            )}
          </div>
        ) : (
          <p
            data-testid="factura-senal-en-preparacion"
            className="flex items-start gap-2 rounded-[12px] border border-emerald-200 bg-emerald-100/50 p-3"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            La factura de señal en borrador se está preparando; estará disponible para revisión en
            breve.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
