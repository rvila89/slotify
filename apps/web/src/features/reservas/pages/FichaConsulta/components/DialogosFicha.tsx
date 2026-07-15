import type { Dispatch, SetStateAction } from 'react';
import {
  GenerarPresupuestoDialog,
  EditarPresupuestoDialog,
  type ConfirmarPresupuestoResponse,
  type EdicionPresupuestoResponse,
  type ReenviarPresupuestoResponse,
} from '@/features/presupuestos';
import { ConfirmarSenalDialog, type ConfirmarSenalResponse } from '@/features/confirmacion';
import { AnadirFechaDialog } from '../../../components/AnadirFechaDialog';
import { PendienteInvitadosDialog } from '../../../components/PendienteInvitadosDialog';
import { ProgramarVisitaDialog } from '../../../components/ProgramarVisitaDialog';
import { RegistrarResultadoVisitaDialog } from '../../../components/RegistrarResultadoVisitaDialog';
import { ExtenderBloqueoDialog } from '../../../components/ExtenderBloqueoDialog';
import { FinalizarEventoDialog } from '../../../components/FinalizarEventoDialog';
import { ArchivarReservaDialog } from '../../../components/ArchivarReservaDialog';
import { MAX_DIAS_PROGRAMAR_VISITA_DEFAULT } from '../../../lib/fecha';
import type { PendienteInvitadosResultado, Reserva } from '../../../model/types';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * Contenedor de los diálogos de transición de la ficha (US-005/007/008/009/010/006/
 * 014/021/034). Extraído de `FichaConsultaPage` para mantener la página ≤300 líneas
 * (regla dura `max-lines`). Presentacional: la página posee el estado de apertura y
 * los resultados; aquí solo se cablean los diálogos a esos setters.
 */
type Props = {
  reservaId: string;
  reserva: Reserva;
  dialogos: {
    fecha: [boolean, Setter<boolean>];
    invitados: [boolean, Setter<boolean>];
    visita: [boolean, Setter<boolean>];
    resultado: [boolean, Setter<boolean>];
    extender: [boolean, Setter<boolean>];
    presupuesto: [boolean, Setter<boolean>];
    editarPresupuesto: [boolean, Setter<boolean>];
    senal: [boolean, Setter<boolean>];
    finalizar: [boolean, Setter<boolean>];
    archivar: [boolean, Setter<boolean>];
  };
  onResuelto: Setter<Reserva | null>;
  onResueltoInvitados: Setter<PendienteInvitadosResultado | null>;
  onResueltoVisita: Setter<Reserva | null>;
  onResueltoInteresado: Setter<Reserva | null>;
  onResueltoReservaInmediata: Setter<Reserva | null>;
  onResueltoExtension: Setter<Reserva | null>;
  onConfirmadoPresupuesto: Setter<ConfirmarPresupuestoResponse | null>;
  onEditadoPresupuesto: (resultado: EdicionPresupuestoResponse) => void;
  onReenviadoPresupuesto: (resultado: ReenviarPresupuestoResponse) => void;
  onConfirmadoSenal: Setter<ConfirmarSenalResponse | null>;
  onFinalizado: Setter<FinalizarEventoResponse | null>;
  onArchivado: Setter<Reserva | null>;
};

export const DialogosFicha = ({
  reservaId,
  reserva,
  dialogos,
  onResuelto,
  onResueltoInvitados,
  onResueltoVisita,
  onResueltoInteresado,
  onResueltoReservaInmediata,
  onResueltoExtension,
  onConfirmadoPresupuesto,
  onEditadoPresupuesto,
  onReenviadoPresupuesto,
  onConfirmadoSenal,
  onFinalizado,
  onArchivado,
}: Props) => (
  <>
    <AnadirFechaDialog
      reservaId={reservaId}
      abierto={dialogos.fecha[0]}
      onAbiertoChange={dialogos.fecha[1]}
      onResuelto={onResuelto}
    />
    <PendienteInvitadosDialog
      reservaId={reservaId}
      abierto={dialogos.invitados[0]}
      onAbiertoChange={dialogos.invitados[1]}
      onResuelto={onResueltoInvitados}
    />
    <ProgramarVisitaDialog
      reservaId={reservaId}
      maxDias={MAX_DIAS_PROGRAMAR_VISITA_DEFAULT}
      abierto={dialogos.visita[0]}
      onAbiertoChange={dialogos.visita[1]}
      onResuelto={onResueltoVisita}
    />
    <RegistrarResultadoVisitaDialog
      reserva={reserva}
      abierto={dialogos.resultado[0]}
      onAbiertoChange={dialogos.resultado[1]}
      onResueltoInteresado={onResueltoInteresado}
      onResueltoReservaInmediata={onResueltoReservaInmediata}
    />
    <ExtenderBloqueoDialog
      reservaId={reservaId}
      ttlActual={reserva.ttlExpiracion}
      abierto={dialogos.extender[0]}
      onAbiertoChange={dialogos.extender[1]}
      onResuelto={onResueltoExtension}
    />
    <GenerarPresupuestoDialog
      reservaId={reservaId}
      abierto={dialogos.presupuesto[0]}
      onAbiertoChange={dialogos.presupuesto[1]}
      onConfirmado={onConfirmadoPresupuesto}
    />
    <EditarPresupuestoDialog
      reservaId={reservaId}
      abierto={dialogos.editarPresupuesto[0]}
      onAbiertoChange={dialogos.editarPresupuesto[1]}
      onEditado={onEditadoPresupuesto}
      onReenviado={onReenviadoPresupuesto}
    />
    <ConfirmarSenalDialog
      reservaId={reservaId}
      abierto={dialogos.senal[0]}
      onAbiertoChange={dialogos.senal[1]}
      onConfirmado={onConfirmadoSenal}
    />
    <FinalizarEventoDialog
      reservaId={reservaId}
      abierto={dialogos.finalizar[0]}
      onAbiertoChange={dialogos.finalizar[1]}
      onFinalizado={onFinalizado}
    />
    <ArchivarReservaDialog
      reservaId={reservaId}
      codigo={reserva.codigo}
      abierto={dialogos.archivar[0]}
      onAbiertoChange={dialogos.archivar[1]}
      onArchivado={onArchivado}
    />
  </>
);
