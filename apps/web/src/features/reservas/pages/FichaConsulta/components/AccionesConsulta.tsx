import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Info,
  Mail,
  Timer,
  Users,
} from 'lucide-react';
import { motivoNoPuedeGenerar, puedeGenerarPresupuesto } from '@/features/presupuestos';
import { puedeConfirmarSenal } from '@/features/confirmacion';
import { bloqueoVigente, puedeExtenderBloqueo } from '../../../lib/fecha';
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
 *  - `2v` (visita programada): "Registrar resultado de visita" (US-009/US-010):
 *    "Cliente interesado" (2.v → 2.b) y "Cliente quiere reservar ahora"
 *    (2.v → pre_reserva).
 *  - `2b/2c/2v` o `pre_reserva` con TTL vigente: "Extender bloqueo" (US-006).
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
  onRegistrarResultadoVisita: () => void;
  onExtenderBloqueo: () => void;
  onGenerarPresupuesto: () => void;
  onConfirmarSenal: () => void;
};

export const AccionesConsulta = ({
  reserva,
  onAnadirFecha,
  onPendienteInvitados,
  onProgramarVisita,
  onRegistrarResultadoVisita,
  onExtenderBloqueo,
  onGenerarPresupuesto,
  onConfirmarSenal,
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
  // US-009 (UC-08): "registrar resultado de visita" solo aplica en `2v` (visita
  // programada). En esta US solo el resultado "Cliente interesado" (2.v → 2.b) está
  // operativo; el servidor revalida de forma defensiva (422 fuera de `2v`).
  const puedeRegistrarResultado = subEstado === '2v';
  // US-006 (D-1): "extender bloqueo" aplica a `2b/2c/2v` o `pre_reserva` con TTL vigente.
  const puedeExtender = puedeExtenderBloqueo({
    estado: reserva.estado,
    subEstado: reserva.subEstado,
    ttlExpiracion: reserva.ttlExpiracion,
  });
  // US-014 (§5.1): "Generar presupuesto" habilitado en `consulta` con
  // `subEstado ∈ {2a,2b,2c,2v}`; deshabilitado en `2d`/terminales/`pre_reserva`+.
  const puedePresupuesto = puedeGenerarPresupuesto({
    estado: reserva.estado,
    subEstado: reserva.subEstado,
  });
  // Solo se muestra la acción (habilitada o bloqueada) mientras la reserva sigue
  // en fase de consulta; en `pre_reserva`+ desaparece (ya hay presupuesto/UC-15).
  const mostrarPresupuesto = reserva.estado === 'consulta';
  // US-021 (UC-17): "Confirmar pago de señal" SOLO cuando la RESERVA está en
  // `pre_reserva`. En cualquier otro estado la acción no se ofrece.
  const puedeConfirmar = puedeConfirmarSenal({ estado: reserva.estado });

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

      {/* US-009/US-010: registrar el resultado de la visita (2v). Interesado y reserva inmediata. */}
      {puedeRegistrarResultado && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            La visita ya está programada. Registra su resultado: si el cliente sigue interesado, la
            fecha se reanuda con un plazo fresco y se le confirma por email; si quiere reservar en el
            acto, la consulta pasa a pre-reserva (fecha bloqueada 7 días).
          </p>
          <button
            type="button"
            data-testid="boton-registrar-resultado-visita"
            onClick={onRegistrarResultadoVisita}
            className={claseBotonAccion}
          >
            <ClipboardCheck aria-hidden className="size-5" />
            Registrar resultado de visita
          </button>
        </div>
      )}

      {/* US-006: extender el plazo del bloqueo blando vigente (2b/2c/2v/pre_reserva). */}
      {puedeExtender && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            Amplía el plazo del bloqueo de la fecha mientras el cliente decide, sin liberarla ni
            disparar la expiración automática. No se notifica al cliente.
          </p>
          <button
            type="button"
            data-testid="boton-extender-bloqueo"
            onClick={onExtenderBloqueo}
            className={claseBotonAccion}
          >
            <Timer aria-hidden className="size-5" />
            Extender bloqueo
          </button>
        </div>
      )}

      {/* US-014: "Generar presupuesto" — habilitada en 2a/2b/2c/2v, bloqueada en 2d/terminales. */}
      {mostrarPresupuesto && (
        <div className="flex flex-col gap-3">
          {puedePresupuesto ? (
            <>
              <p className="font-body text-sm text-text-secondary">
                Genera el presupuesto con la tarifa vigente y activa la pre-reserva: se creará el
                presupuesto, la fecha quedará bloqueada 7 días y se enviará al cliente por email.
              </p>
              <button
                type="button"
                data-testid="boton-generar-presupuesto"
                onClick={onGenerarPresupuesto}
                className={claseBotonAccion}
              >
                <FileText aria-hidden className="size-5" />
                Generar presupuesto
              </button>
            </>
          ) : (
            <>
              <p data-testid="aviso-presupuesto-bloqueado" className={claseTextoInfo}>
                <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
                {motivoNoPuedeGenerar({ estado: reserva.estado, subEstado: reserva.subEstado })}
              </p>
              <button
                type="button"
                data-testid="boton-generar-presupuesto"
                disabled
                aria-disabled="true"
                className={claseBotonAccion}
              >
                <FileText aria-hidden className="size-5" />
                Generar presupuesto
              </button>
            </>
          )}
        </div>
      )}

      {/* US-021: "Confirmar pago de señal" — solo en `pre_reserva`. */}
      {puedeConfirmar && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            El cliente ha aceptado el presupuesto. Adjunta el justificante del pago de la señal
            para confirmar la reserva: la fecha quedará bloqueada en firme, se congelarán los
            importes de señal y liquidación y se iniciarán los sub-procesos del evento.
          </p>
          <button
            type="button"
            data-testid="boton-confirmar-senal"
            onClick={onConfirmarSenal}
            className={claseBotonAccion}
          >
            <CheckCircle2 aria-hidden className="size-5" />
            Confirmar pago de señal
          </button>
        </div>
      )}

      {/* Terminales u otros estados sin acciones disponibles. */}
      {!esExploratoria &&
        !puedePendienteInvitados &&
        !puedeProgramarVisita &&
        !puedeRegistrarResultado &&
        !enCola &&
        !puedeExtender &&
        !mostrarPresupuesto &&
        !puedeConfirmar && (
          <p className={claseTextoInfo}>
            <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
            No hay acciones disponibles para esta consulta en su estado actual.
          </p>
        )}
    </div>
  );
};
