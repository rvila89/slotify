import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, User } from 'lucide-react';
import { AvisoPresupuestoConfirmado, type ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import { AvisoReservaConfirmada, type ConfirmarSenalResponse } from '@/features/confirmacion';
import {
  FacturaSenalCard,
  DocumentosLiquidacionFianza,
  DevolucionFianzaCard,
} from '@/features/facturacion';
import { FichaOperativaCard } from '@/features/ficha-operativa';
import { CondicionesFirmadasCard, debeMostrarSeccionCondiciones } from '@/features/condiciones-firmadas';
import { useReserva } from '../../api/useReserva';
import { formatearFecha } from '../../lib/fecha';
import { Badge } from './components/Badge';
import { Dato } from './components/Dato';
import { AccionesConsulta } from './components/AccionesConsulta';
import { AvisosTransicion } from './components/AvisosTransicion';
import { AvisoPendienteInvitados } from './components/AvisoPendienteInvitados';
import { AvisoVisitaProgramada } from './components/AvisoVisitaProgramada';
import { AvisoResultadoVisita } from './components/AvisoResultadoVisita';
import { AvisoReservaInmediata } from './components/AvisoReservaInmediata';
import { AvisoBloqueoExtendido } from './components/AvisoBloqueoExtendido';
import { AvisoEventoFinalizado } from './components/AvisoEventoFinalizado';
import { DialogosFicha } from './components/DialogosFicha';
import { IbanDevolucionCard } from '../../components/IbanDevolucionCard';
import { puedeRegistrarIban } from '../../lib/ibanDevolucion';
import type { PendienteInvitadosResultado, Reserva } from '../../model/types';
import type { components } from '@/api-client';
type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Ficha de consulta/reserva. Muestra el detalle de una RESERVA y, según su estado y
 * sub-estado, ofrece las acciones de transición del pipeline (US-005/007/008/006/
 * 014/021/034) vía diálogos de dominio. Los avisos del desenlace y los fragmentos
 * visuales viven en `components/`.
 */
export const FichaConsultaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [dialogoInvitadosAbierto, setDialogoInvitadosAbierto] = useState(false);
  const [dialogoVisitaAbierto, setDialogoVisitaAbierto] = useState(false);
  const [dialogoResultadoAbierto, setDialogoResultadoAbierto] = useState(false);
  const [dialogoExtenderAbierto, setDialogoExtenderAbierto] = useState(false);
  const [dialogoPresupuestoAbierto, setDialogoPresupuestoAbierto] = useState(false);
  const [dialogoSenalAbierto, setDialogoSenalAbierto] = useState(false);
  const [dialogoFinalizarAbierto, setDialogoFinalizarAbierto] = useState(false);
  const [dialogoArchivarAbierto, setDialogoArchivarAbierto] = useState(false);
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
  // Resultado de la confirmación de señal (US-021): alimenta su aviso (reserva_confirmada).
  const [resultadoSenal, setResultadoSenal] = useState<ConfirmarSenalResponse | null>(null);
  // Resultado de la finalización del evento (US-034, post_evento + E5 + docs pendiente).
  const [resultadoFinalizar, setResultadoFinalizar] = useState<FinalizarEventoResponse | null>(null);
  // Resultado del archivado manual (US-038): la RESERVA en `reserva_completada`. El éxito
  // se comunica por toast; la reserva se refetch y sale del pipeline (el botón desaparece).
  const [, setResultadoArchivar] = useState<Reserva | null>(null);

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
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
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
        <AvisoVisitaProgramada reserva={resultadoVisita} onCerrar={() => setResultadoVisita(null)} />
      )}
      {resultadoInteresado && (
        <AvisoResultadoVisita
          reserva={resultadoInteresado}
          onCerrar={() => setResultadoInteresado(null)}
        />
      )}
      {resultadoReservaInmediata && (
        <AvisoReservaInmediata
          reserva={resultadoReservaInmediata}
          onCerrar={() => setResultadoReservaInmediata(null)}
        />
      )}
      {resultadoExtension && (
        <AvisoBloqueoExtendido
          reserva={resultadoExtension}
          onCerrar={() => setResultadoExtension(null)}
        />
      )}
      {resultadoPresupuesto && (
        <AvisoPresupuestoConfirmado
          resultado={resultadoPresupuesto}
          onCerrar={() => setResultadoPresupuesto(null)}
        />
      )}
      {resultadoSenal && (
        <AvisoReservaConfirmada resultado={resultadoSenal} onCerrar={() => setResultadoSenal(null)} />
      )}
      {resultadoFinalizar && (
        <AvisoEventoFinalizado
          resultado={resultadoFinalizar}
          onCerrar={() => setResultadoFinalizar(null)}
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
          onConfirmarSenal={() => {
            setResultadoSenal(null);
            setDialogoSenalAbierto(true);
          }}
          onFinalizarEvento={() => {
            setResultadoFinalizar(null);
            setDialogoFinalizarAbierto(true);
          }}
          onArchivarReserva={() => {
            setResultadoArchivar(null);
            setDialogoArchivarAbierto(true);
          }}
        />
      </section>

      {id && reserva.estado === 'reserva_confirmada' && <FacturaSenalCard reservaId={id} />}

      {id && reserva.estado === 'reserva_confirmada' && (
        <DocumentosLiquidacionFianza
          reservaId={id}
          liquidacionStatus={reserva.liquidacionStatus}
          fianzaStatus={reserva.fianzaStatus}
          fechaEvento={reserva.fechaEvento}
          fianzaEur={reserva.fianzaEur}
          fianzaCobradaFecha={reserva.fianzaCobradaFecha}
        />
      )}

      {/* Ficha operativa del evento (US-025): editable desde `reserva_confirmada`
          y fases posteriores. El propio componente resuelve el 409
          `ficha_no_disponible` mostrando el mensaje contextual. */}
      {id &&
        (reserva.estado === 'reserva_confirmada' ||
          reserva.estado === 'evento_en_curso' ||
          reserva.estado === 'post_evento') && <FichaOperativaCard reservaId={id} />}

      {/* US-024: registrar la firma de las condiciones particulares. Visible en los
          tres estados válidos del ciclo (`reserva_confirmada`, `evento_en_curso`,
          `post_evento`). La tarjeta resuelve internamente los estados de la UI:
          E3 no enviado (acción no disponible), pendiente de firma (alerta FA-01 +
          acción), firmada (resumen) y re-firma. El backend revalida (409/422). */}
      {id && debeMostrarSeccionCondiciones(reserva) && (
        <CondicionesFirmadasCard
          reservaId={id}
          condPartFechaEnvio={reserva.condPartFechaEnvio}
          condPartFirmadas={reserva.condPartFirmadas}
          condPartFechaFirma={reserva.condPartFechaFirma}
        />
      )}

      {/* US-035: registrar el IBAN de devolución. Solo visible en `post_evento` con
          fianza cobrada (`fianzaEur > 0`) — FA-04; precarga el IBAN existente del
          cliente en corrección — FA-02. El backend revalida la precondición (409). */}
      {id && puedeRegistrarIban(reserva.estado, reserva.fianzaEur) && (
        <IbanDevolucionCard reservaId={id} ibanExistente={reserva.cliente?.ibanDevolucion} />
      )}

      {/* US-036: registrar la devolución de la fianza. Visible en `post_evento` con fianza cobrada
          (`fianzaEur > 0`). La tarjeta habilita la acción solo cuando además hay IBAN de devolución
          (precondición triple), muestra el resumen final si ya está devuelta/retenida_parcial y el
          aviso de FA-04 si se registró sin justificante. El backend revalida (409). */}
      {id && reserva.estado === 'post_evento' && puedeRegistrarIban(reserva.estado, reserva.fianzaEur) && (
        <DevolucionFianzaCard
          reservaId={id}
          estado={reserva.estado}
          fianzaStatus={reserva.fianzaStatus}
          fianzaEur={reserva.fianzaEur}
          fianzaCobradaFecha={reserva.fianzaCobradaFecha}
          fianzaDevueltaEur={reserva.fianzaDevueltaEur}
          fianzaDevueltaFecha={reserva.fianzaDevueltaFecha}
          motivoRetencion={reserva.motivoRetencion}
          ibanDevolucion={reserva.cliente?.ibanDevolucion}
        />
      )}

      {id && (
        <DialogosFicha
          reservaId={id}
          reserva={reserva}
          dialogos={{
            fecha: [dialogoAbierto, setDialogoAbierto],
            invitados: [dialogoInvitadosAbierto, setDialogoInvitadosAbierto],
            visita: [dialogoVisitaAbierto, setDialogoVisitaAbierto],
            resultado: [dialogoResultadoAbierto, setDialogoResultadoAbierto],
            extender: [dialogoExtenderAbierto, setDialogoExtenderAbierto],
            presupuesto: [dialogoPresupuestoAbierto, setDialogoPresupuestoAbierto],
            senal: [dialogoSenalAbierto, setDialogoSenalAbierto],
            finalizar: [dialogoFinalizarAbierto, setDialogoFinalizarAbierto],
            archivar: [dialogoArchivarAbierto, setDialogoArchivarAbierto],
          }}
          onResuelto={setResultado}
          onResueltoInvitados={setResultadoInvitados}
          onResueltoVisita={setResultadoVisita}
          onResueltoInteresado={setResultadoInteresado}
          onResueltoReservaInmediata={setResultadoReservaInmediata}
          onResueltoExtension={setResultadoExtension}
          onConfirmadoPresupuesto={setResultadoPresupuesto}
          onConfirmadoSenal={setResultadoSenal}
          onFinalizado={setResultadoFinalizar}
          onArchivado={setResultadoArchivar}
        />
      )}
    </div>
  );
};
