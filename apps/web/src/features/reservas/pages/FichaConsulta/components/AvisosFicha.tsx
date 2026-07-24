import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import type { ConfirmarSenalResponse } from '@/features/confirmacion';
import { AvisosTransicion } from './AvisosTransicion';
import { AvisoPendienteInvitados } from './AvisoPendienteInvitados';
import { AvisoVisitaProgramada } from './AvisoVisitaProgramada';
import { AvisoResultadoVisita } from './AvisoResultadoVisita';
import { AvisoReservaInmediata } from './AvisoReservaInmediata';
import { AvisoBloqueoExtendido } from './AvisoBloqueoExtendido';
import { AvisosEdicionPresupuesto, type ResultadoEdicion } from './AvisosEdicionPresupuesto';
import { AvisoEmailEnviado } from './AvisoEmailEnviado';
import { AvisoDescarte } from './AvisoDescarte';
import { AvisoEdicionConsulta } from './AvisoEdicionConsulta';
import { AvisoCondicionesFirmadas } from '@/features/condiciones-firmadas';
import { AvisoFacturaSenalEnviada } from './AvisoFacturaSenalEnviada';
import { AvisoSolicitudDatosBorrador } from './AvisoSolicitudDatosBorrador';
import type { PendienteInvitadosResultado, Reserva } from '../../../model/types';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];
type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/**
 * Contenedor de todos los avisos de desenlace de la ficha (transiciones del pipeline
 * US-005/007/008/009/010/006 + tramo pre_reserva→post_evento US-014/015/021/032/034).
 * Extraído de `FichaConsultaPage` para mantener la página ≤300 líneas (regla dura
 * `max-lines`). Presentacional: cada aviso se muestra si su resultado no es nulo; el
 * cierre limpia el estado en la página vía los `onCerrar*`.
 */
type Props = {
  resultado: Reserva | null;
  invitados: PendienteInvitadosResultado | null;
  visita: Reserva | null;
  interesado: Reserva | null;
  reservaInmediata: Reserva | null;
  extension: Reserva | null;
  presupuesto: ConfirmarPresupuestoResponse | null;
  edicion: ResultadoEdicion | null;
  senal: ConfirmarSenalResponse | null;
  forzar: ForzarInicioEventoResponse | null;
  finalizar: FinalizarEventoResponse | null;
  /** Envío manual del borrador E1 confirmado (mejoras-detalle-consulta §D-3). */
  emailEnviado: boolean;
  /** Desenlace terminal de descarte (consulta US-013 / pre-reserva): aviso inline verde
      en la cabecera, en sustitución del toast de Sonner. */
  descarte: { reserva: Reserva; tipo: 'consulta' | 'prereserva' } | null;
  /** Firma de condicions particulars registrada (Mejora C): banner inline verde en la
      cabecera, en sustitución del toast de Sonner. */
  firma: 'registrada' | 'reregistrada' | null;
  /** Edición exitosa de campos simples de la consulta (US-051 §Punto 2): banner
      inline verde con el código de la consulta. */
  edicionConsulta: string | null;
  /** Factura de señal enviada al cliente (E3 inicial): banner inline verde. */
  facturaEnviada: boolean;
  /** Borrador de solicitud de datos fiscales creado desde el modal de presupuesto
      (change solicitud-datos-presupuesto-borrador): banner inline verde. */
  solicitudDatos: boolean;
  /** Cierra el aviso visible. Único por el invariante "un solo aviso a la vez": todos
      los avisos comparten el mismo `useAvisosFicha().cerrar`, que limpia todo el estado. */
  onCerrar: () => void;
};

export const AvisosFicha = ({
  resultado,
  invitados,
  visita,
  interesado,
  reservaInmediata,
  extension,
  presupuesto,
  edicion,
  senal,
  forzar,
  finalizar,
  emailEnviado,
  descarte,
  firma,
  edicionConsulta,
  facturaEnviada,
  solicitudDatos,
  onCerrar,
}: Props) => (
  <>
    {emailEnviado && <AvisoEmailEnviado onCerrar={onCerrar} />}
    {firma && <AvisoCondicionesFirmadas tipo={firma} onCerrar={onCerrar} />}
    {edicionConsulta && <AvisoEdicionConsulta codigo={edicionConsulta} onCerrar={onCerrar} />}
    {descarte && (
      <AvisoDescarte tipo={descarte.tipo} codigo={descarte.reserva.codigo} onCerrar={onCerrar} />
    )}
    {resultado && <AvisosTransicion resultado={resultado} onCerrar={onCerrar} />}
    {invitados && <AvisoPendienteInvitados resultado={invitados} onCerrar={onCerrar} />}
    {visita && <AvisoVisitaProgramada reserva={visita} onCerrar={onCerrar} />}
    {interesado && <AvisoResultadoVisita reserva={interesado} onCerrar={onCerrar} />}
    {reservaInmediata && (
      <AvisoReservaInmediata reserva={reservaInmediata} onCerrar={onCerrar} />
    )}
    {extension && <AvisoBloqueoExtendido reserva={extension} onCerrar={onCerrar} />}
    <AvisosEdicionPresupuesto
      presupuesto={presupuesto}
      edicion={edicion}
      senal={senal}
      forzar={forzar}
      finalizar={finalizar}
      onCerrarPresupuesto={onCerrar}
      onCerrarEdicion={onCerrar}
      onCerrarSenal={onCerrar}
      onCerrarForzar={onCerrar}
      onCerrarFinalizar={onCerrar}
    />
    {facturaEnviada && <AvisoFacturaSenalEnviada onCerrar={onCerrar} />}
    {solicitudDatos && <AvisoSolicitudDatosBorrador onCerrar={onCerrar} />}
  </>
);
