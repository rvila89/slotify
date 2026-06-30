import { CalendarClock, X } from 'lucide-react';
import { formatearFecha, formatearFechaHora } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Aviso de éxito de la transición a `2v` (US-008). Muestra el feedback acordado: la
 * fecha y hora de la visita confirmadas, el nuevo `ttlExpiracion` del bloqueo (=
 * fecha de visita + 1 día) y la confirmación de envío del email E6 al cliente.
 */
export const AvisoVisitaProgramada = ({
  reserva,
  onCerrar,
}: {
  reserva: Reserva;
  onCerrar: () => void;
}) => (
  <div
    role="status"
    data-testid="alerta-visita-programada"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Visita programada</p>
      <p className="font-body text-sm">
        {reserva.visitaProgramadaFecha ? (
          <>
            La visita queda fijada para el{' '}
            <strong>
              {formatearFecha(reserva.visitaProgramadaFecha)}
              {reserva.visitaProgramadaHora ? ` a las ${reserva.visitaProgramadaHora}` : ''}
            </strong>
            .{' '}
          </>
        ) : (
          'La visita ha quedado programada. '
        )}
        {reserva.ttlExpiracion ? (
          <>
            La fecha del evento queda <strong>bloqueada</strong> hasta el{' '}
            <strong>{formatearFechaHora(reserva.ttlExpiracion)}</strong>.{' '}
          </>
        ) : null}
        Se ha enviado un email de confirmación al cliente.
      </p>
    </div>
    <button
      type="button"
      aria-label="Cerrar aviso"
      onClick={onCerrar}
      className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
    >
      <X aria-hidden className="size-4" />
    </button>
  </div>
);
