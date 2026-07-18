import {
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  Flag,
  Info,
  Mail,
  Timer,
  Users,
} from 'lucide-react';
import { puedeEditarPresupuesto } from '@/features/presupuestos';
import { puedeConfirmarSenal } from '@/features/confirmacion';
import { aforoDeReserva } from '../../../lib/aforo';
import { bloqueoVigente, puedeExtenderBloqueo } from '../../../lib/fecha';
import { puedeFinalizarEvento } from '../../../lib/finalizarEvento';
import { puedeForzarInicioEvento } from '../../../lib/forzarInicioEvento';
import { puedeArchivarReserva } from '../../../lib/archivarReserva';
import { esConsultaTerminal } from '../../../lib/estadoTerminal';
import { AccionArchivar } from './AccionArchivar';
import { AccionDescartar } from './AccionDescartar';
import { AccionEditarConsulta } from './AccionEditarConsulta';
import { AccionForzarInicio } from './AccionForzarInicio';
import { AccionPresupuesto } from './AccionPresupuesto';
import { AccionesPreReserva } from './AccionesPreReserva';
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

const claseTextoSinAcciones = 'flex items-start gap-3 font-body text-sm text-text-secondary';

const FallbackSinAcciones = () => (
  <p data-testid="sin-acciones" className={claseTextoSinAcciones}>
    <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
    No hay acciones disponibles para esta consulta en su estado actual.
  </p>
);

type Props = {
  reserva: Reserva;
  onAnadirFecha: () => void;
  onPendienteInvitados: () => void;
  onProgramarVisita: () => void;
  onRegistrarResultadoVisita: () => void;
  onExtenderBloqueo: () => void;
  onGenerarPresupuesto: () => void;
  onEditarConsulta: () => void;
  onEditarPresupuesto: () => void;
  onConfirmarSenal: () => void;
  onDescartarPreReserva: () => void;
  onForzarInicioEvento: () => void;
  onFinalizarEvento: () => void;
  onArchivarReserva: () => void;
  onDescartarConsulta: () => void;
};

export const AccionesConsulta = ({
  reserva,
  onAnadirFecha,
  onPendienteInvitados,
  onProgramarVisita,
  onRegistrarResultadoVisita,
  onExtenderBloqueo,
  onGenerarPresupuesto,
  onEditarConsulta,
  onEditarPresupuesto,
  onConfirmarSenal,
  onDescartarPreReserva,
  onForzarInicioEvento,
  onFinalizarEvento,
  onArchivarReserva,
  onDescartarConsulta,
}: Props) => {
  // US-047 (Step 7): mientras exista un borrador E1 pendiente de envío, el cliente
  // aún no sabe que la consulta existe, así que NINGUNA acción tiene sentido (incluida
  // "Marcar como descartada"). Se sustituye todo el bloque de acciones por un aviso.
  if (reserva.tieneBorradorE1Pendiente) {
    return (
      <div
        data-testid="aviso-borrador-e1-pendiente"
        className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-800"
      >
        <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <span>Revisa y envía el correo de confirmación antes de continuar.</span>
      </div>
    );
  }

  // US-051 (§Punto 4): en consultas cerradas (sub-estados terminales `2x/2y/2z` o
  // estados terminales `reserva_cancelada`/`reserva_completada`) NO se ofrece
  // NINGUNA acción, ni deshabilitada: solo el fallback "sin acciones".
  if (esConsultaTerminal(reserva)) {
    return <FallbackSinAcciones />;
  }

  const subEstado = reserva.subEstado;
  // US-051 (§Punto 2): "Editar consulta" mientras la consulta esté ACTIVA (en fase
  // `consulta` no terminal). Fuera de `consulta` los datos ya no se editan por aquí.
  const puedeEditarConsulta = reserva.estado === 'consulta';
  const esExploratoria = subEstado === '2a';
  const tieneFechaEvento = Boolean(reserva.fechaEvento);
  // US-007 (D-1): "pendiente de invitados" solo aplica a `2b` con bloqueo vigente y,
  // además, mientras NO se hayan introducido invitados para la reserva (si ya se
  // conoce el aforo, la transición "pendiente de nº de invitados" no tiene sentido).
  const sinInvitados = aforoDeReserva(reserva) == null;
  const puedePendienteInvitados =
    subEstado === '2b' && bloqueoVigente(reserva.ttlExpiracion) && sinInvitados;
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
  // US-014 (§5.1): "Generar presupuesto" (bloque en `AccionPresupuesto`) solo se
  // muestra en fase `consulta`; alimenta el fallback "sin acciones".
  const mostrarPresupuesto = reserva.estado === 'consulta';
  // US-015 (UC-15): "Editar presupuesto" SOLO cuando la RESERVA está en `pre_reserva`
  // (un presupuesto aceptado/rechazado la saca de ese estado). El backend revalida el
  // estado del último PRESUPUESTO de forma defensiva (409 si aceptado/fuera de fase).
  const puedeEditar = puedeEditarPresupuesto({ estado: reserva.estado });
  // US-021 (UC-17): "Confirmar pago de señal" SOLO cuando la RESERVA está en
  // `pre_reserva`. En cualquier otro estado la acción no se ofrece.
  const puedeConfirmar = puedeConfirmarSenal({ estado: reserva.estado });
  // US-034 (UC-25): "Marcar evento como finalizado" SOLO cuando la RESERVA está en
  // `evento_en_curso`. La transición a `post_evento` es irreversible.
  const puedeFinalizar = puedeFinalizarEvento(reserva.estado);
  // US-032 (UC-23 FA-01): "Forzar inicio del evento" SOLO en `reserva_confirmada` +
  // `fechaEvento` de hoy (guarda de origen + fecha). El bloque vive en
  // `AccionForzarInicio` (max-lines); la guarda solo alimenta el fallback "sin
  // acciones". El backend revalida (409 `conflicto_estado` / 422 `fecha_evento_no_es_hoy`).
  const puedeForzarInicio = puedeForzarInicioEvento(reserva.estado, reserva.fechaEvento, new Date());
  // US-038 (UC-28, flujo manual): "Archivar reserva" SOLO cuando la RESERVA está en
  // `post_evento`. El bloque de la acción (deshabilitado con la razón si la fianza no
  // está resuelta) vive en `AccionArchivar` para no superar `max-lines`.
  const puedeArchivar = puedeArchivarReserva(reserva.estado);
  // US-013 (UC-10, A17 manual): "Marcar como descartada por cliente" — el bloque
  // se ofrece mientras la RESERVA sigue en fase `consulta` (habilitado en
  // `2a/2b/2c/2d/2v`, deshabilitado con motivo en terminales `2x/2y/2z`). En
  // `pre_reserva`+ desaparece (ya no es un lead descartable por el cliente).
  const mostrarDescartar = reserva.estado === 'consulta';

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
      {/* US-014: "Generar presupuesto" — CTA principal para avanzar de estado (verde),
          visible solo en `consulta`. El bloque vive en `AccionPresupuesto` (max-lines).
          US-051 §Punto 3: si faltan datos, ofrece el atajo a "Editar consulta". */}
      <AccionPresupuesto
        reserva={reserva}
        onGenerarPresupuesto={onGenerarPresupuesto}
        onEditarConsulta={onEditarConsulta}
      />

      {/* US-051 §Punto 2: "Editar consulta" — visible mientras la consulta esté ACTIVA. */}
      <AccionEditarConsulta reserva={reserva} onEditarConsulta={onEditarConsulta} />

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

      {/* US-015 + US-021: acciones de la fase `pre_reserva` (editar presupuesto /
          confirmar señal), extraídas para respetar el límite de 300 líneas. */}
      <AccionesPreReserva
        reserva={reserva}
        onEditarPresupuesto={onEditarPresupuesto}
        onConfirmarSenal={onConfirmarSenal}
        onDescartarPreReserva={onDescartarPreReserva}
      />

      {/* US-032: "Forzar inicio del evento" — solo en `reserva_confirmada` + fecha de
          hoy. El bloque (lista de precondiciones + botón) vive en `AccionForzarInicio`
          para respetar max-lines; dispara la doble confirmación (POST en el diálogo). */}
      <AccionForzarInicio reserva={reserva} onForzarInicioEvento={onForzarInicioEvento} />

      {/* US-034: "Marcar evento como finalizado" — solo en `evento_en_curso`. */}
      {puedeFinalizar && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            El evento ya está en curso. Al finalizarlo, la reserva pasará a post-evento (acción
            irreversible) y, si hay fianza cobrada, se enviará al cliente la solicitud del IBAN
            para su devolución junto al agradecimiento y la encuesta de satisfacción.
          </p>
          <button
            type="button"
            data-testid="boton-finalizar-evento"
            onClick={onFinalizarEvento}
            className={claseBotonAccion}
          >
            <Flag aria-hidden className="size-5" />
            Marcar evento como finalizado
          </button>
        </div>
      )}

      {/* US-038: "Archivar reserva" — solo en `post_evento`. Deshabilitada con la
          razón si la fianza no está resuelta (FA-01/FA-02); el backend revalida (422). */}
      <AccionArchivar reserva={reserva} onArchivarReserva={onArchivarReserva} />

      {/* US-013: "Marcar como descartada por cliente" — visible en fase `consulta`.
          Deshabilitada (con motivo) en sub_estados terminales; el backend revalida
          (409 `transicion_no_permitida`). */}
      {mostrarDescartar && (
        <AccionDescartar reserva={reserva} onDescartarConsulta={onDescartarConsulta} />
      )}

      {/* Otros estados no terminales sin acciones aplicables (los terminales ya
          retornan antes). */}
      {!esExploratoria &&
        !puedePendienteInvitados &&
        !puedeProgramarVisita &&
        !puedeRegistrarResultado &&
        !enCola &&
        !puedeExtender &&
        !mostrarPresupuesto &&
        !puedeEditarConsulta &&
        !puedeEditar &&
        !puedeConfirmar &&
        !puedeForzarInicio &&
        !puedeFinalizar &&
        !puedeArchivar &&
        !mostrarDescartar && <FallbackSinAcciones />}
    </div>
  );
};
