import { CheckCircle2, X } from 'lucide-react';
import { formatearFechaHora } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Aviso de éxito de la transición "Cliente interesado" (US-009, 2.v → 2.b). Muestra
 * el feedback acordado: la consulta vuelve a estar bloqueada con un plazo fresco
 * (`ttlExpiracion = now + ttl_consulta_dias`) y se ha enviado el email E7 de
 * confirmación post-visita al cliente.
 */
export const AvisoResultadoVisita = ({
  reserva,
  onCerrar,
}: {
  reserva: Reserva;
  onCerrar: () => void;
}) => (
  <div
    role="status"
    data-testid="alerta-resultado-visita"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Interés del cliente registrado</p>
      <p className="font-body text-sm">
        La visita se ha marcado como realizada y la consulta vuelve a estar{' '}
        <strong>bloqueada provisionalmente</strong>.{' '}
        {reserva.ttlExpiracion ? (
          <>
            El cliente tiene hasta el <strong>{formatearFechaHora(reserva.ttlExpiracion)}</strong>{' '}
            para decidir.{' '}
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
