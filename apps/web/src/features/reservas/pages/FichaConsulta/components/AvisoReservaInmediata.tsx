import { FileCheck, X } from 'lucide-react';
import { formatearFechaHora } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Aviso de éxito de la transición "Cliente quiere reservar ahora" (US-010,
 * 2.v → pre_reserva). Comunica el feedback acordado: la visita queda realizada, la
 * consulta pasa a **pre-reserva** con la fecha bloqueada 7 días
 * (`ttlExpiracion = now + ttl_prereserva_dias`) y su cola de espera se ha vaciado.
 * La generación del presupuesto formal (UC-14) es un paso aparte y NO se dispara
 * aquí; el texto lo deja claro.
 */
export const AvisoReservaInmediata = ({
  reserva,
  onCerrar,
}: {
  reserva: Reserva;
  onCerrar: () => void;
}) => (
  <div
    role="status"
    data-testid="alerta-reserva-inmediata"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <FileCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Pre-reserva iniciada</p>
      <p className="font-body text-sm">
        La visita se ha marcado como realizada y la consulta ha pasado a{' '}
        <strong>pre-reserva</strong>: la fecha queda bloqueada
        {reserva.ttlExpiracion ? (
          <>
            {' '}
            hasta el <strong>{formatearFechaHora(reserva.ttlExpiracion)}</strong>
          </>
        ) : (
          ' durante el plazo de pre-reserva'
        )}{' '}
        y cualquier consulta en cola para esa fecha se ha liberado. El siguiente paso es{' '}
        <strong>generar el presupuesto</strong> desde el área de Pre-reserva y Presupuestos.
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
