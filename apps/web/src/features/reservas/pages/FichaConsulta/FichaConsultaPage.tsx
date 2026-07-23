import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, User } from 'lucide-react';
import { useReserva } from '../../api/useReserva';
import { formatearFecha } from '../../lib/fecha';
import { puedeForzarInicioEvento } from '../../lib/forzarInicioEvento';
import { Badge } from './components/Badge';
import { Dato } from './components/Dato';
import { DetallesEvento } from './components/DetallesEvento';
import { AccionesConsulta } from './components/AccionesConsulta';
import { AvisosFicha } from './components/AvisosFicha';
import { DialogosFicha } from './components/DialogosFicha';
import { SeccionesFicha } from './components/SeccionesFicha';
import { useAvisosFicha } from './useAvisosFicha';
import type { Reserva } from '../../model/types';

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
  // Estado centralizado de TODOS los avisos de desenlace. Garantiza el invariante de
  // "como máximo un aviso visible a la vez (el último)": cada `mostrar*` limpia los
  // demás y `cerrar()` los limpia todos. Antes eran ~14 useState independientes que
  // podían coexistir (change `2026-07-20-descarte-aviso-inline-ficha`).
  const avisos = useAvisosFicha();
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

  const ESTADOS_RESERVA = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ] as const;
  const esReserva = (ESTADOS_RESERVA as readonly string[]).includes(reserva.estado);
  const tituloFicha = esReserva ? 'Reserva' : 'Consulta';

  // US-051 §D-2: la fecha se gestiona por el flujo atómico según el sub-estado —
  // `2a` (sin fecha) usa "Añadir fecha" (`POST /fecha`); `2b/2c/2v` (fecha ya
  // bloqueada) usa el cambio atómico (`POST /cambiar-fecha`). El editor se cierra
  // antes de abrir el diálogo de fecha para no anidar diálogos.
  // Desenlace de la transición de fecha (US-005 / cambio atómico): además de alimentar
  // el aviso 2b/2d, desplaza la vista al aviso para que el gestor lo vea (§D-4). SSR-safe.
  const mostrarResultadoFecha = (r: Reserva | null) => {
    if (!r) {
      avisos.cerrar();
      return;
    }
    avisos.mostrarResultado(r);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            {tituloFicha} {reserva.codigo}
          </h1>
          <Badge subEstado={subEstado} estado={reserva.estado} />
        </div>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          {esReserva
            ? 'Ficha de la reserva. Revisa los datos y gestiona la reserva según su estado.'
            : 'Ficha del lead. Revisa los datos y gestiona la consulta según su estado.'}
        </p>
      </header>

      <AvisosFicha
        resultado={avisos.resultado}
        invitados={avisos.invitados}
        visita={avisos.visita}
        interesado={avisos.interesado}
        reservaInmediata={avisos.reservaInmediata}
        extension={avisos.extension}
        presupuesto={avisos.presupuesto}
        edicion={avisos.edicion}
        senal={avisos.senal}
        forzar={avisos.forzar}
        finalizar={avisos.finalizar}
        onCerrarResultado={avisos.cerrar}
        onCerrarInvitados={avisos.cerrar}
        onCerrarVisita={avisos.cerrar}
        onCerrarInteresado={avisos.cerrar}
        onCerrarReservaInmediata={avisos.cerrar}
        onCerrarExtension={avisos.cerrar}
        onCerrarPresupuesto={avisos.cerrar}
        onCerrarEdicion={avisos.cerrar}
        onCerrarSenal={avisos.cerrar}
        onCerrarForzar={avisos.cerrar}
        onCerrarFinalizar={avisos.cerrar}
        emailEnviado={avisos.emailEnviado}
        onCerrarEmailEnviado={avisos.cerrar}
        descarte={avisos.descarte}
        onCerrarDescarte={avisos.cerrar}
        firma={avisos.firma}
        onCerrarFirma={avisos.cerrar}
        edicionConsulta={avisos.edicionConsulta}
        onCerrarEdicionConsulta={avisos.cerrar}
        facturaEnviada={avisos.facturaEnviada}
        onCerrarFacturaEnviada={avisos.cerrar}
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

      {/* Acciones: se oculta en `reserva_confirmada` cuando la única acción posible
          ("Forzar inicio") no está disponible (hoy no es el día del evento). */}
      {(reserva.estado !== 'reserva_confirmada' ||
        puedeForzarInicioEvento(reserva.estado, reserva.fechaEvento, new Date())) && (
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
            avisos.cerrar();
            setDialogoAbierto(true);
          }}
          onCambiarFecha={() => {
            avisos.cerrar();
            setDialogoCambiarFechaAbierto(true);
          }}
          onPendienteInvitados={() => {
            avisos.cerrar();
            setDialogoInvitadosAbierto(true);
          }}
          onProgramarVisita={() => {
            avisos.cerrar();
            setDialogoVisitaAbierto(true);
          }}
          onRegistrarResultadoVisita={() => {
            avisos.cerrar();
            setDialogoResultadoAbierto(true);
          }}
          onExtenderBloqueo={() => {
            avisos.cerrar();
            setDialogoExtenderAbierto(true);
          }}
          onGenerarPresupuesto={() => {
            avisos.cerrar();
            setDialogoPresupuestoAbierto(true);
          }}
          onEditarConsulta={() => setDialogoEditarAbierto(true)}
          onEditarPresupuesto={() => {
            avisos.cerrar();
            setDialogoEditarPresupuestoAbierto(true);
          }}
          onConfirmarSenal={() => {
            avisos.cerrar();
            setDialogoSenalAbierto(true);
          }}
          onForzarInicioEvento={() => {
            avisos.cerrar();
            setDialogoForzarInicioAbierto(true);
          }}
          onFinalizarEvento={() => {
            avisos.cerrar();
            setDialogoFinalizarAbierto(true);
          }}
          onArchivarReserva={() => setDialogoArchivarAbierto(true)}
          onDescartarConsulta={() => {
            avisos.cerrar();
            setDialogoDescartarAbierto(true);
          }}
          onDescartarPreReserva={() => {
            avisos.cerrar();
            setDialogoDescartarPreReservaAbierto(true);
          }}
        />
      </section>
      )}

      {id && (
        <SeccionesFicha
          reservaId={id}
          reserva={reserva}
          onEmailEnviado={() => {
            avisos.mostrarEmailEnviado();
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          onFirmaRegistrada={(tipo) => {
            avisos.mostrarFirma(tipo);
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          onFacturaSenalEnviada={() => {
            avisos.mostrarFacturaSenalEnviada();
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
          onResuelto={mostrarResultadoFecha}
          onCambiadaFecha={mostrarResultadoFecha}
          onEditado={() => {
            avisos.mostrarEdicionConsulta(reserva.codigo);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onResueltoInvitados={avisos.mostrarInvitados}
          onResueltoVisita={avisos.mostrarVisita}
          onResueltoInteresado={avisos.mostrarInteresado}
          onResueltoReservaInmediata={avisos.mostrarReservaInmediata}
          onResueltoExtension={avisos.mostrarExtension}
          onConfirmadoPresupuesto={(resultado) => {
            avisos.mostrarPresupuesto(resultado);
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onEditadoPresupuesto={(datos) => {
            avisos.mostrarEdicion({ clase: 'edicion', datos });
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onReenviadoPresupuesto={(datos) => {
            avisos.mostrarEdicion({ clase: 'reenvio', datos });
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onConfirmadoSenal={(resultado) => {
            avisos.mostrarSenal(resultado);
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onForzado={avisos.mostrarForzar}
          onFinalizado={avisos.mostrarFinalizar}
          // Desenlaces terminales (archivado US-038 / descarte US-013): el descarte
          // muestra un aviso inline verde en la cabecera (en sustitución del toast de
          // Sonner) y desplaza la vista al inicio para que el gestor lo vea.
          onArchivado={() => {}}
          onDescartado={(reserva) => {
            avisos.mostrarDescarte({ reserva, tipo: 'consulta' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onDescartadoPreReserva={(reserva) => {
            avisos.mostrarDescarte({ reserva, tipo: 'prereserva' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
};
