import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import type { ConfirmarSenalResponse } from '@/features/confirmacion';
import { AvisosTransicion } from './AvisosTransicion';
import { AvisoPendienteInvitados } from './AvisoPendienteInvitados';
import { AvisoVisitaProgramada } from './AvisoVisitaProgramada';
import { AvisoResultadoVisita } from './AvisoResultadoVisita';
import { AvisoReservaInmediata } from './AvisoReservaInmediata';
import { AvisoBloqueoExtendido } from './AvisoBloqueoExtendido';
import { AvisosEdicionPresupuesto, type ResultadoEdicion } from './AvisosEdicionPresupuesto';
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
  onCerrarResultado: () => void;
  onCerrarInvitados: () => void;
  onCerrarVisita: () => void;
  onCerrarInteresado: () => void;
  onCerrarReservaInmediata: () => void;
  onCerrarExtension: () => void;
  onCerrarPresupuesto: () => void;
  onCerrarEdicion: () => void;
  onCerrarSenal: () => void;
  onCerrarForzar: () => void;
  onCerrarFinalizar: () => void;
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
  onCerrarResultado,
  onCerrarInvitados,
  onCerrarVisita,
  onCerrarInteresado,
  onCerrarReservaInmediata,
  onCerrarExtension,
  onCerrarPresupuesto,
  onCerrarEdicion,
  onCerrarSenal,
  onCerrarForzar,
  onCerrarFinalizar,
}: Props) => (
  <>
    {resultado && <AvisosTransicion resultado={resultado} onCerrar={onCerrarResultado} />}
    {invitados && <AvisoPendienteInvitados resultado={invitados} onCerrar={onCerrarInvitados} />}
    {visita && <AvisoVisitaProgramada reserva={visita} onCerrar={onCerrarVisita} />}
    {interesado && <AvisoResultadoVisita reserva={interesado} onCerrar={onCerrarInteresado} />}
    {reservaInmediata && (
      <AvisoReservaInmediata reserva={reservaInmediata} onCerrar={onCerrarReservaInmediata} />
    )}
    {extension && <AvisoBloqueoExtendido reserva={extension} onCerrar={onCerrarExtension} />}
    <AvisosEdicionPresupuesto
      presupuesto={presupuesto}
      edicion={edicion}
      senal={senal}
      forzar={forzar}
      finalizar={finalizar}
      onCerrarPresupuesto={onCerrarPresupuesto}
      onCerrarEdicion={onCerrarEdicion}
      onCerrarSenal={onCerrarSenal}
      onCerrarForzar={onCerrarForzar}
      onCerrarFinalizar={onCerrarFinalizar}
    />
  </>
);
