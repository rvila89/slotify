import { Users, X } from 'lucide-react';
import { formatearFechaHora } from '../../../lib/fecha';
import type { PendienteInvitadosResultado } from '../../../model/types';

/**
 * Aviso de éxito de la transición 2.b → 2.c (US-007). Muestra el feedback
 * acordado (D-7, sin email): el nuevo `ttlExpiracion` del bloqueo y el recuento de
 * `consultasDescartadas` de la cola vaciada (A16). En singular/plural y con un
 * mensaje específico cuando no había cola (0 descartadas).
 */
export const AvisoPendienteInvitados = ({
  resultado,
  onCerrar,
}: {
  resultado: PendienteInvitadosResultado;
  onCerrar: () => void;
}) => {
  const { reserva, consultasDescartadas } = resultado;
  return (
    <div
      role="status"
      data-testid="alerta-pendiente-invitados"
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
    >
      <Users aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div className="flex-1">
        <p className="font-body text-sm font-bold">Consulta marcada como pendiente de invitados</p>
        <p className="font-body text-sm">
          {reserva.ttlExpiracion ? (
            <>
              Se ha ampliado el bloqueo de la fecha:{' '}
              <strong>vigente hasta el {formatearFechaHora(reserva.ttlExpiracion)}</strong>.
            </>
          ) : (
            'Se ha ampliado el plazo del bloqueo de la fecha.'
          )}{' '}
          {consultasDescartadas > 0 ? (
            <>
              Se{' '}
              <strong>
                {consultasDescartadas === 1
                  ? 'ha descartado 1 consulta'
                  : `han descartado ${consultasDescartadas} consultas`}
              </strong>{' '}
              que esperaban en la cola de esta fecha.
            </>
          ) : (
            'No había consultas en cola para esta fecha.'
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
};
