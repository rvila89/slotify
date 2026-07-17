import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import type { ConfirmarSenalResponse } from '@/features/confirmacion';
import type { components } from '@/api-client';
import { AvisosTransicion } from './AvisosTransicion';
import { AvisoPendienteInvitados } from './AvisoPendienteInvitados';
import { AvisoVisitaProgramada } from './AvisoVisitaProgramada';
import { AvisoResultadoVisita } from './AvisoResultadoVisita';
import { AvisoReservaInmediata } from './AvisoReservaInmediata';
import { AvisoBloqueoExtendido } from './AvisoBloqueoExtendido';
import { AvisosEdicionPresupuesto, type ResultadoEdicion } from './AvisosEdicionPresupuesto';
import type { PendienteInvitadosResultado, Reserva } from '../../../model/types';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

/**
 * Agrupa los avisos de resultado de las transiciones del pipeline (US-005/007/008/009/
 * 010/006/014/015/021/034) que la `FichaConsultaPage` muestra tras cada acción exitosa.
 * Extraído de la página para mantenerla dentro del límite `max-lines` (regla dura); es
 * puramente presentacional (los estados y sus setters siguen viviendo en la página).
 */
type Props = {
  resultado: Reserva | null;
  resultadoInvitados: PendienteInvitadosResultado | null;
  resultadoVisita: Reserva | null;
  resultadoInteresado: Reserva | null;
  resultadoReservaInmediata: Reserva | null;
  resultadoExtension: Reserva | null;
  resultadoPresupuesto: ConfirmarPresupuestoResponse | null;
  resultadoEdicion: ResultadoEdicion | null;
  resultadoSenal: ConfirmarSenalResponse | null;
  resultadoFinalizar: FinalizarEventoResponse | null;
  onCerrarResultado: () => void;
  onCerrarInvitados: () => void;
  onCerrarVisita: () => void;
  onCerrarInteresado: () => void;
  onCerrarReservaInmediata: () => void;
  onCerrarExtension: () => void;
  onCerrarPresupuesto: () => void;
  onCerrarEdicion: () => void;
  onCerrarSenal: () => void;
  onCerrarFinalizar: () => void;
};

export const AvisosResultadoTransicion = ({
  resultado,
  resultadoInvitados,
  resultadoVisita,
  resultadoInteresado,
  resultadoReservaInmediata,
  resultadoExtension,
  resultadoPresupuesto,
  resultadoEdicion,
  resultadoSenal,
  resultadoFinalizar,
  onCerrarResultado,
  onCerrarInvitados,
  onCerrarVisita,
  onCerrarInteresado,
  onCerrarReservaInmediata,
  onCerrarExtension,
  onCerrarPresupuesto,
  onCerrarEdicion,
  onCerrarSenal,
  onCerrarFinalizar,
}: Props) => (
  <>
    {resultado && <AvisosTransicion resultado={resultado} onCerrar={onCerrarResultado} />}
    {resultadoInvitados && (
      <AvisoPendienteInvitados resultado={resultadoInvitados} onCerrar={onCerrarInvitados} />
    )}
    {resultadoVisita && (
      <AvisoVisitaProgramada reserva={resultadoVisita} onCerrar={onCerrarVisita} />
    )}
    {resultadoInteresado && (
      <AvisoResultadoVisita reserva={resultadoInteresado} onCerrar={onCerrarInteresado} />
    )}
    {resultadoReservaInmediata && (
      <AvisoReservaInmediata
        reserva={resultadoReservaInmediata}
        onCerrar={onCerrarReservaInmediata}
      />
    )}
    {resultadoExtension && (
      <AvisoBloqueoExtendido reserva={resultadoExtension} onCerrar={onCerrarExtension} />
    )}
    <AvisosEdicionPresupuesto
      presupuesto={resultadoPresupuesto}
      edicion={resultadoEdicion}
      senal={resultadoSenal}
      finalizar={resultadoFinalizar}
      onCerrarPresupuesto={onCerrarPresupuesto}
      onCerrarEdicion={onCerrarEdicion}
      onCerrarSenal={onCerrarSenal}
      onCerrarFinalizar={onCerrarFinalizar}
    />
  </>
);
