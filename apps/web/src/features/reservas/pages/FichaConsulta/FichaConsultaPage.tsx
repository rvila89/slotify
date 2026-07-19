import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, User } from 'lucide-react';
import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import type { ConfirmarSenalResponse } from '@/features/confirmacion';
import { useReserva } from '../../api/useReserva';
import { formatearFecha } from '../../lib/fecha';
import { Badge } from './components/Badge';
import { Dato } from './components/Dato';
import { DetallesEvento } from './components/DetallesEvento';
import { AccionesConsulta } from './components/AccionesConsulta';
import { AvisosFicha } from './components/AvisosFicha';
import { DialogosFicha } from './components/DialogosFicha';
import type { ResultadoEdicion } from './components/AvisosEdicionPresupuesto';
import { SeccionesFicha } from './components/SeccionesFicha';
import type { PendienteInvitadosResultado, Reserva } from '../../model/types';
import type { components } from '@/api-client';
type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];
type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Ficha de consulta/reserva. Muestra el detalle de una RESERVA y, según su estado y
 * sub-estado, ofrece las acciones de transición del pipeline (US-005/007/008/006/
 * 014/021/034/013) vía diálogos de dominio. Los avisos y fragmentos viven en `components/`.
 */
export const FichaConsultaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [dialogoCambiarFechaAbierto, setDialogoCambiarFechaAbierto] = useState(false);
  const [dialogoEditarAbierto, setDialogoEditarAbierto] = useState(false);
  const [dialogoInvitadosAbierto, setDialogoInvitadosAbierto] = useState(false);
  const [dialogoVisitaAbierto, setDialogoVisitaAbierto] = useState(false);
  const [dialogoResultadoAbierto, setDialogoResultadoAbierto] = useState(false);
  const [dialogoExtenderAbierto, setDialogoExtenderAbierto] = useState(false);
  const [dialogoPresupuestoAbierto, setDialogoPresupuestoAbierto] = useState(false);
  const [dialogoEditarPresupuestoAbierto, setDialogoEditarPresupuestoAbierto] = useState(false);
  const [dialogoSenalAbierto, setDialogoSenalAbierto] = useState(false);
  const [dialogoForzarInicioAbierto, setDialogoForzarInicioAbierto] = useState(false);
  const [dialogoFinalizarAbierto, setDialogoFinalizarAbierto] = useState(false);
  const [dialogoArchivarAbierto, setDialogoArchivarAbierto] = useState(false);
  const [dialogoDescartarAbierto, setDialogoDescartarAbierto] = useState(false);
  const [dialogoDescartarPreReservaAbierto, setDialogoDescartarPreReservaAbierto] =
    useState(false);
  // RESERVA resultante de la transición de fecha (US-005): alimenta el aviso 2b/2d.
  const [resultado, setResultado] = useState<Reserva | null>(null);
  // Resultado de la transición 2.b → 2.c (US-007): alimenta su aviso (TTL + cola).
  const [resultadoInvitados, setResultadoInvitados] = useState<PendienteInvitadosResultado | null>(
    null,
  );
  // RESERVA resultante de la transición a 2.v (US-008): alimenta su aviso (visita + TTL).
  const [resultadoVisita, setResultadoVisita] = useState<Reserva | null>(null);
  // RESERVA resultante del resultado de visita "interesado" (US-009, 2.v → 2.b): alimenta su aviso.
  const [resultadoInteresado, setResultadoInteresado] = useState<Reserva | null>(null);
  // RESERVA resultante de "reserva inmediata" (US-010, 2.v → pre_reserva): alimenta su aviso.
  const [resultadoReservaInmediata, setResultadoReservaInmediata] = useState<Reserva | null>(null);
  // RESERVA resultante de la extensión del bloqueo (US-006): alimenta su aviso (nuevo TTL).
  const [resultadoExtension, setResultadoExtension] = useState<Reserva | null>(null);
  // Resultado de la confirmación del presupuesto (US-014): alimenta su aviso (pre_reserva).
  const [resultadoPresupuesto, setResultadoPresupuesto] =
    useState<ConfirmarPresupuestoResponse | null>(null);
  // Resultado de la edición/reenvío del presupuesto (US-015): edición enviada/guardada
  // (`clase='edicion'`) o reenvío sin cambios (`clase='reenvio'`).
  const [resultadoEdicion, setResultadoEdicion] = useState<ResultadoEdicion | null>(null);
  // Resultado de la confirmación de señal (US-021): alimenta su aviso (reserva_confirmada).
  const [resultadoSenal, setResultadoSenal] = useState<ConfirmarSenalResponse | null>(null);
  // Resultado del forzado del inicio de evento (US-032, evento_en_curso + precondiciones).
  const [resultadoForzar, setResultadoForzar] = useState<ForzarInicioEventoResponse | null>(null);
  // Resultado de la finalización del evento (US-034, post_evento + E5 + docs pendiente).
  const [resultadoFinalizar, setResultadoFinalizar] = useState<FinalizarEventoResponse | null>(null);
  // Envío MANUAL del borrador E1 confirmado (mejoras-detalle-consulta §D-3): alimenta el
  // aviso de éxito arriba, como el E1 automático. El refetch de la reserva (invalidación
  // en `useEnviarBorrador`) desbloquea las acciones sin recargar.
  const [emailEnviado, setEmailEnviado] = useState(false);
  if (isLoading) {
    return (
      <p data-testid="ficha-cargando" className="font-body text-sm text-text-secondary">
        Cargando consulta…
      </p>
    );
  }

  if (isError || !reserva) {
    return (
      <div
        role="alert"
        data-testid="ficha-error"
        className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
      >
        No se ha podido cargar la consulta. Comprueba el enlace o vuelve al listado.
      </div>
    );
  }

  const cliente = reserva.cliente;
  const nombreCliente = cliente
    ? `${cliente.nombre ?? ''} ${cliente.apellidos ?? ''}`.trim() || 'Cliente'
    : 'Cliente';
  const subEstado = reserva.subEstado;

  // US-051 §D-2: la fecha se gestiona por el flujo atómico según el sub-estado —
  // `2a` (sin fecha) usa "Añadir fecha" (`POST /fecha`); `2b/2c/2v` (fecha ya
  // bloqueada) usa el cambio atómico (`POST /cambiar-fecha`). El editor se cierra
  // antes de abrir el diálogo de fecha para no anidar diálogos.
  const gestionarFecha = () => {
    setDialogoEditarAbierto(false);
    if (subEstado === '2a') {
      setResultado(null);
      setDialogoAbierto(true);
    } else {
      setDialogoCambiarFechaAbierto(true);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Consulta {reserva.codigo}
          </h1>
          <Badge subEstado={subEstado} />
        </div>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Ficha del lead. Revisa los datos y gestiona la consulta según su estado.
        </p>
      </header>

      <AvisosFicha
        resultado={resultado}
        invitados={resultadoInvitados}
        visita={resultadoVisita}
        interesado={resultadoInteresado}
        reservaInmediata={resultadoReservaInmediata}
        extension={resultadoExtension}
        presupuesto={resultadoPresupuesto}
        edicion={resultadoEdicion}
        senal={resultadoSenal}
        forzar={resultadoForzar}
        finalizar={resultadoFinalizar}
        onCerrarResultado={() => setResultado(null)}
        onCerrarInvitados={() => setResultadoInvitados(null)}
        onCerrarVisita={() => setResultadoVisita(null)}
        onCerrarInteresado={() => setResultadoInteresado(null)}
        onCerrarReservaInmediata={() => setResultadoReservaInmediata(null)}
        onCerrarExtension={() => setResultadoExtension(null)}
        onCerrarPresupuesto={() => setResultadoPresupuesto(null)}
        onCerrarEdicion={() => setResultadoEdicion(null)}
        onCerrarSenal={() => setResultadoSenal(null)}
        onCerrarForzar={() => setResultadoForzar(null)}
        onCerrarFinalizar={() => setResultadoFinalizar(null)}
        emailEnviado={emailEnviado}
        onCerrarEmailEnviado={() => setEmailEnviado(false)}
      />

      <section className={claseSeccion} aria-labelledby="ficha-cliente">
        <div id="ficha-cliente" className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <User aria-hidden className="size-4" />
          </span>
          <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
            Datos del lead
          </h2>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <Dato etiqueta="Cliente" valor={nombreCliente} />
          {cliente?.email && <Dato etiqueta="Email" valor={cliente.email} />}
          {cliente?.telefono && <Dato etiqueta="Teléfono" valor={cliente.telefono} />}
          <Dato etiqueta="Canal de entrada" valor={reserva.canalEntrada} />
          {reserva.tipoEvento && <Dato etiqueta="Tipo de evento" valor={reserva.tipoEvento} />}
          <Dato
            etiqueta="Fecha del evento"
            valor={reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : 'Sin asignar'}
          />
          {reserva.visitaProgramadaFecha && (
            <Dato
              etiqueta="Visita programada"
              valor={`${formatearFecha(reserva.visitaProgramadaFecha)}${reserva.visitaProgramadaHora ? ` · ${reserva.visitaProgramadaHora}` : ''}`}
            />
          )}
          {typeof reserva.posicionCola === 'number' && (
            <Dato etiqueta="Posición en cola" valor={`${reserva.posicionCola}`} />
          )}
        </dl>
      </section>

      {/* US-051 §Punto 1: "Detalles del evento" — duración, invitados, hora de inicio y
          comentarios, con placeholder para los opcionales ausentes. */}
      <DetallesEvento reserva={reserva} />

      <section className={claseSeccion} aria-labelledby="ficha-acciones">
        <div id="ficha-acciones" className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <CalendarPlus aria-hidden className="size-4" />
          </span>
          <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
            Acciones
          </h2>
        </div>

        <AccionesConsulta
          reserva={reserva}
          onAnadirFecha={() => {
            setResultado(null);
            setDialogoAbierto(true);
          }}
          onPendienteInvitados={() => {
            setResultadoInvitados(null);
            setDialogoInvitadosAbierto(true);
          }}
          onProgramarVisita={() => {
            setResultadoVisita(null);
            setDialogoVisitaAbierto(true);
          }}
          onRegistrarResultadoVisita={() => {
            setResultadoInteresado(null);
            setResultadoReservaInmediata(null);
            setDialogoResultadoAbierto(true);
          }}
          onExtenderBloqueo={() => {
            setResultadoExtension(null);
            setDialogoExtenderAbierto(true);
          }}
          onGenerarPresupuesto={() => {
            setResultadoPresupuesto(null);
            setDialogoPresupuestoAbierto(true);
          }}
          onEditarConsulta={() => setDialogoEditarAbierto(true)}
          onEditarPresupuesto={() => {
            setResultadoEdicion(null);
            setDialogoEditarPresupuestoAbierto(true);
          }}
          onConfirmarSenal={() => {
            setResultadoSenal(null);
            setDialogoSenalAbierto(true);
          }}
          onForzarInicioEvento={() => {
            setResultadoForzar(null);
            setDialogoForzarInicioAbierto(true);
          }}
          onFinalizarEvento={() => {
            setResultadoFinalizar(null);
            setDialogoFinalizarAbierto(true);
          }}
          onArchivarReserva={() => setDialogoArchivarAbierto(true)}
          onDescartarConsulta={() => setDialogoDescartarAbierto(true)}
          onDescartarPreReserva={() => setDialogoDescartarPreReservaAbierto(true)}
        />
      </section>

      {id && (
        <SeccionesFicha
          reservaId={id}
          reserva={reserva}
          onEmailEnviado={() => {
            setEmailEnviado(true);
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        />
      )}

      {id && (
        <DialogosFicha
          reservaId={id}
          reserva={reserva}
          dialogos={{
            fecha: [dialogoAbierto, setDialogoAbierto],
            cambiarFecha: [dialogoCambiarFechaAbierto, setDialogoCambiarFechaAbierto],
            editar: [dialogoEditarAbierto, setDialogoEditarAbierto],
            invitados: [dialogoInvitadosAbierto, setDialogoInvitadosAbierto],
            visita: [dialogoVisitaAbierto, setDialogoVisitaAbierto],
            resultado: [dialogoResultadoAbierto, setDialogoResultadoAbierto],
            extender: [dialogoExtenderAbierto, setDialogoExtenderAbierto],
            presupuesto: [dialogoPresupuestoAbierto, setDialogoPresupuestoAbierto],
            editarPresupuesto: [dialogoEditarPresupuestoAbierto, setDialogoEditarPresupuestoAbierto],
            senal: [dialogoSenalAbierto, setDialogoSenalAbierto],
            forzarInicio: [dialogoForzarInicioAbierto, setDialogoForzarInicioAbierto],
            finalizar: [dialogoFinalizarAbierto, setDialogoFinalizarAbierto],
            archivar: [dialogoArchivarAbierto, setDialogoArchivarAbierto],
            descartar: [dialogoDescartarAbierto, setDialogoDescartarAbierto],
            descartarPreReserva: [
              dialogoDescartarPreReservaAbierto,
              setDialogoDescartarPreReservaAbierto,
            ],
          }}
          onResuelto={setResultado}
          onCambiadaFecha={setResultado}
          onEditado={() => {}}
          onGestionarFecha={gestionarFecha}
          onResueltoInvitados={setResultadoInvitados}
          onResueltoVisita={setResultadoVisita}
          onResueltoInteresado={setResultadoInteresado}
          onResueltoReservaInmediata={setResultadoReservaInmediata}
          onResueltoExtension={setResultadoExtension}
          onConfirmadoPresupuesto={setResultadoPresupuesto}
          onEditadoPresupuesto={(datos) => setResultadoEdicion({ clase: 'edicion', datos })}
          onReenviadoPresupuesto={(datos) => setResultadoEdicion({ clase: 'reenvio', datos })}
          onConfirmadoSenal={setResultadoSenal}
          onForzado={setResultadoForzar}
          onFinalizado={setResultadoFinalizar}
          // Desenlaces terminales (archivado US-038 / descarte US-013): toast +
          // refetch en el diálogo; la página no guarda estado. Al descartar,
          // devolvemos el "puntero" al inicio de la página para que el foco
          // visual vuelva a la cabecera (mismo patrón que NuevaConsultaPage).
          onArchivado={() => {}}
          onDescartado={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onDescartadoPreReserva={() => {}}
        />
      )}
    </div>
  );
};
