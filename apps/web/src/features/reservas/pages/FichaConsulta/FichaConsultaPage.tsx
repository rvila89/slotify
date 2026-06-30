import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, User } from 'lucide-react';
import { useReserva } from '../../api/useReserva';
import { AnadirFechaDialog } from '../../components/AnadirFechaDialog';
import { PendienteInvitadosDialog } from '../../components/PendienteInvitadosDialog';
import { ProgramarVisitaDialog } from '../../components/ProgramarVisitaDialog';
import { MAX_DIAS_PROGRAMAR_VISITA_DEFAULT, formatearFecha } from '../../lib/fecha';
import { Badge } from './components/Badge';
import { Dato } from './components/Dato';
import { AccionesConsulta } from './components/AccionesConsulta';
import { AvisosTransicion } from './components/AvisosTransicion';
import { AvisoPendienteInvitados } from './components/AvisoPendienteInvitados';
import { AvisoVisitaProgramada } from './components/AvisoVisitaProgramada';
import type { PendienteInvitadosResultado, Reserva } from '../../model/types';

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Ficha de consulta (US-005/US-007/US-008 · UC-04/06/07). Muestra el detalle de una
 * RESERVA y, según su sub-estado, ofrece las acciones de transición (Añadir fecha,
 * Pendiente de invitados, Programar visita) vía diálogos de dominio. Los avisos del
 * desenlace y los fragmentos visuales viven en `components/`.
 */
export const FichaConsultaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [dialogoInvitadosAbierto, setDialogoInvitadosAbierto] = useState(false);
  const [dialogoVisitaAbierto, setDialogoVisitaAbierto] = useState(false);
  // RESERVA resultante de la transición de fecha (US-005): alimenta el aviso 2b/2d.
  const [resultado, setResultado] = useState<Reserva | null>(null);
  // Resultado de la transición 2.b → 2.c (US-007): alimenta su aviso (TTL + cola).
  const [resultadoInvitados, setResultadoInvitados] = useState<PendienteInvitadosResultado | null>(
    null,
  );
  // RESERVA resultante de la transición a 2.v (US-008): alimenta su aviso (visita + TTL).
  const [resultadoVisita, setResultadoVisita] = useState<Reserva | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
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

      {resultado && <AvisosTransicion resultado={resultado} onCerrar={() => setResultado(null)} />}

      {resultadoInvitados && (
        <AvisoPendienteInvitados
          resultado={resultadoInvitados}
          onCerrar={() => setResultadoInvitados(null)}
        />
      )}

      {resultadoVisita && (
        <AvisoVisitaProgramada
          reserva={resultadoVisita}
          onCerrar={() => setResultadoVisita(null)}
        />
      )}

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
        />
      </section>

      {id && (
        <AnadirFechaDialog
          reservaId={id}
          abierto={dialogoAbierto}
          onAbiertoChange={setDialogoAbierto}
          onResuelto={setResultado}
        />
      )}

      {id && (
        <PendienteInvitadosDialog
          reservaId={id}
          abierto={dialogoInvitadosAbierto}
          onAbiertoChange={setDialogoInvitadosAbierto}
          onResuelto={setResultadoInvitados}
        />
      )}

      {id && (
        <ProgramarVisitaDialog
          reservaId={id}
          maxDias={MAX_DIAS_PROGRAMAR_VISITA_DEFAULT}
          abierto={dialogoVisitaAbierto}
          onAbiertoChange={setDialogoVisitaAbierto}
          onResuelto={setResultadoVisita}
        />
      )}
    </div>
  );
};
