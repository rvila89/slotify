import { CheckCircle2, X } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import type { ConfirmarPresupuestoResponse } from '../model/types';

/**
 * Aviso de éxito tras confirmar el presupuesto (US-014 · UC-14). Confirma que la
 * RESERVA pasó a `pre_reserva` y resume el total y la cola vaciada (A16). El PDF se
 * adjunta al email E2 (post-commit); si el backend devolvió `pdfUrl` se ofrece el
 * enlace. Componente de presentación puro.
 *
 * Mobile-first: el bloque es `flex` con texto que fluye; el botón de cerrar queda
 * a la derecha sin romper en 390px.
 */
type Props = {
  resultado: ConfirmarPresupuestoResponse;
  onCerrar: () => void;
};

export const AvisoPresupuestoConfirmado = ({ resultado, onCerrar }: Props) => {
  const total = resultado.presupuesto.total;
  const descartadas = resultado.consultasDescartadas ?? 0;
  const pdfUrl = resultado.presupuesto.pdfUrl;

  return (
    <div
      role="status"
      data-testid="aviso-presupuesto-confirmado"
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div className="flex flex-1 flex-col gap-2 font-body text-sm">
        <p className="font-medium">
          Presupuesto generado. La reserva ha pasado a <strong>pre-reserva</strong> con un bloqueo
          de fecha de 7 días.
        </p>
        <p>
          Total del presupuesto: <strong>{formatearEuros(total)}</strong> (IVA 21% incluido). Se ha
          enviado el email al cliente con el presupuesto adjunto.
        </p>
        {descartadas > 0 && (
          <p>
            Se han descartado <strong>{descartadas}</strong> consulta(s) de la cola de espera de
            esta fecha.
          </p>
        )}
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-emerald-700 underline"
          >
            Ver el PDF del presupuesto
          </a>
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
