import { CalendarClock, X } from 'lucide-react';
import { formatearFechaHora } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Aviso de éxito del override "Extender bloqueo" (US-006). Muestra el feedback
 * acordado: el nuevo `ttlExpiracion` del bloqueo tras la prórroga. No hay email al
 * cliente (la US no envía notificación); el estado/sub_estado no cambian.
 */
export const AvisoBloqueoExtendido = ({
  reserva,
  onCerrar,
}: {
  reserva: Reserva;
  onCerrar: () => void;
}) => (
  <div
    role="status"
    data-testid="alerta-bloqueo-extendido"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Bloqueo extendido</p>
      <p className="font-body text-sm">
        {reserva.ttlExpiracion ? (
          <>
            El bloqueo de la fecha del evento se mantiene ahora hasta el{' '}
            <strong>{formatearFechaHora(reserva.ttlExpiracion)}</strong>.
          </>
        ) : (
          'El plazo del bloqueo se ha ampliado correctamente.'
        )}
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
