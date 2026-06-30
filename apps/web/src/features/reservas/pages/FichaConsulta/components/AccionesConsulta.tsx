import { CalendarClock, CalendarPlus, Info, Mail, Users } from 'lucide-react';
import { bloqueoVigente } from '../../../lib/fecha';
import type { Reserva } from '../../../model/types';

/**
 * Sección "Acciones" de la ficha de consulta. Decide, según el sub-estado de la
 * RESERVA, qué transiciones ofrece y cuáles quedan bloqueadas con su explicación:
 *  - `2a` (exploratoria): "Añadir fecha" (US-005). "Programar visita" (US-008) solo
 *    si `fechaEvento` está definida; si es NULL se informa de que debe introducirse
 *    primero (la acción de visita queda bloqueada).
 *  - `2b` con bloqueo vigente: "Pendiente de invitados" (US-007) y "Programar visita".
 *  - `2c`: "Programar visita".
 *  - `2d` (cola): "Programar visita" deshabilitada con mensaje UC-12.
 *  - terminales (`2x/2y/2z`) u otros: sin acciones.
 *
 * Las comprobaciones de cliente solo habilitan/deshabilitan; el servidor revalida de
 * forma defensiva (409/422).
 */
const claseBotonAccion =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onAnadirFecha: () => void;
  onPendienteInvitados: () => void;
  onProgramarVisita: () => void;
};

export const AccionesConsulta = ({
  reserva,
  onAnadirFecha,
  onPendienteInvitados,
  onProgramarVisita,
}: Props) => {
  const subEstado = reserva.subEstado;
  const esExploratoria = subEstado === '2a';
  const tieneFechaEvento = Boolean(reserva.fechaEvento);
  // US-007 (D-1): "pendiente de invitados" solo aplica a `2b` con bloqueo vigente.
  const puedePendienteInvitados = subEstado === '2b' && bloqueoVigente(reserva.ttlExpiracion);
  // US-008 (D-1): "programar visita" aplica a `2a/2b/2c`; en `2a` requiere `fechaEvento`.
  const origenVisitaValido =
    subEstado === '2a' || subEstado === '2b' || subEstado === '2c';
  const puedeProgramarVisita = origenVisitaValido && (subEstado !== '2a' || tieneFechaEvento);
  const enCola = subEstado === '2d';

  const botonVisita = (
    <button
      type="button"
      data-testid="boton-programar-visita"
      onClick={onProgramarVisita}
      className={claseBotonAccion}
    >
      <CalendarClock aria-hidden className="size-5" />
      Programar visita
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      {esExploratoria && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            Esta consulta es exploratoria (sin fecha). Añade una fecha para intentar bloquearla; si
            está ocupada, podrás entrar en la cola de espera.
          </p>
          <button
            type="button"
            data-testid="boton-anadir-fecha"
            onClick={onAnadirFecha}
            className={claseBotonAccion}
          >
            <CalendarPlus aria-hidden className="size-5" />
            Añadir fecha
          </button>
        </div>
      )}

      {puedePendienteInvitados && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            Esta consulta tiene una fecha bloqueada provisionalmente. Si el cliente tiene intención
            firme, márcala como pendiente de número de invitados: se ampliará el plazo del bloqueo y
            se vaciará su cola de espera.
          </p>
          <button
            type="button"
            data-testid="boton-pendiente-invitados"
            onClick={onPendienteInvitados}
            className={claseBotonAccion}
          >
            <Users aria-hidden className="size-5" />
            Marcar como pendiente de invitados
          </button>
        </div>
      )}

      {puedeProgramarVisita && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            Programa una visita presencial al espacio. La fecha del evento se bloqueará hasta el día
            posterior a la visita y se enviará un email de confirmación al cliente.
          </p>
          {botonVisita}
        </div>
      )}

      {/* 2a sin fecha_evento: la visita queda bloqueada hasta introducir la fecha del evento. */}
      {esExploratoria && !tieneFechaEvento && (
        <p data-testid="aviso-visita-sin-fecha" className={claseTextoInfo}>
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          Para programar una visita primero debes añadir la fecha del evento a esta consulta.
        </p>
      )}

      {/* 2d (cola): la transición directa a 2v no está permitida (UC-12). */}
      {enCola && (
        <div className="flex flex-col gap-3">
          <p data-testid="aviso-visita-en-cola" className={claseTextoInfo}>
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
            No es posible programar una visita para una consulta en cola. La consulta debe ser
            promovida primero (UC-12).
          </p>
          <button
            type="button"
            data-testid="boton-programar-visita"
            disabled
            aria-disabled="true"
            className={claseBotonAccion}
          >
            <CalendarClock aria-hidden className="size-5" />
            Programar visita
          </button>
        </div>
      )}

      {/* Terminales u otros estados sin acciones disponibles. */}
      {!esExploratoria && !puedePendienteInvitados && !puedeProgramarVisita && !enCola && (
        <p className={claseTextoInfo}>
          <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          No hay acciones disponibles para esta consulta en su estado actual.
        </p>
      )}
    </div>
  );
};
