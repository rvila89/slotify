import { CalendarCheck, Clock, X } from 'lucide-react';
import { formatearFecha, formatearFechaHora } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Avisos del desenlace de la transición de fecha mostrados en la ficha:
 *  - `2b`: bloqueo provisional (+ email al cliente) con su `ttlExpiracion`.
 *  - `2d`: entrada en cola con `posicionCola`.
 */
export const AvisosTransicion = ({
  resultado,
  onCerrar,
}: {
  resultado: Reserva;
  onCerrar: () => void;
}) => (
  <>
    {resultado.subEstado === '2b' && (
      <div
        role="status"
        data-testid="alerta-fecha-bloqueada"
        className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
      >
        <CalendarCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <p className="font-body text-sm font-bold">Fecha reservada provisionalmente</p>
          <p className="font-body text-sm">
            {resultado.fechaEvento ? (
              <>
                La fecha <strong>{formatearFecha(resultado.fechaEvento)}</strong> ha quedado{' '}
                <strong>bloqueada</strong> (bloqueo blando)
                {resultado.ttlExpiracion ? ` hasta el ${formatearFechaHora(resultado.ttlExpiracion)}` : ''}
                . Se ha enviado un email de confirmación al cliente. Confírmala antes de que expire
                para no perder la reserva.
              </>
            ) : (
              'La fecha ha quedado bloqueada (bloqueo blando) y se ha enviado un email de confirmación al cliente.'
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
    )}

    {resultado.subEstado === '2d' && (
      <div
        role="status"
        data-testid="alerta-cola"
        className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
      >
        <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="font-body text-sm font-bold">Consulta en cola de espera</p>
          <p className="font-body text-sm">
            {resultado.fechaEvento ? (
              <>
                La fecha <strong>{formatearFecha(resultado.fechaEvento)}</strong> ya estaba ocupada.{' '}
              </>
            ) : null}
            Tu consulta ha entrado en la cola en la{' '}
            <strong>posición {resultado.posicionCola}</strong>. Te avisaremos si la fecha se libera.
          </p>
        </div>
        <button
          type="button"
          aria-label="Cerrar aviso"
          onClick={onCerrar}
          className="rounded-full p-1 text-amber-700 transition hover:bg-amber-100"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    )}
  </>
);
