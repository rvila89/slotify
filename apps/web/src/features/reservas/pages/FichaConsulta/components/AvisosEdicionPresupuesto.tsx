import {
  AvisoPresupuestoConfirmado,
  AvisoPresupuestoEditado,
  type ConfirmarPresupuestoResponse,
  type EdicionPresupuestoResponse,
  type ReenviarPresupuestoResponse,
} from '@/features/presupuestos';
import { AvisoReservaConfirmada, type ConfirmarSenalResponse } from '@/features/confirmacion';
import { AvisoEventoForzado } from './AvisoEventoForzado';
import { AvisoEventoFinalizado } from './AvisoEventoFinalizado';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];
type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/**
 * Avisos de éxito del tramo `pre_reserva` → `post_evento` de la ficha: presupuesto
 * generado (US-014), edición/reenvío del presupuesto (US-015), señal confirmada
 * (US-021) y evento finalizado (US-034). Se agrupan aquí para mantener
 * `FichaConsultaPage` ≤300 líneas (regla dura `max-lines`). Cada aviso se muestra si
 * su resultado no es nulo; el cierre limpia el estado en la página (setters por props).
 */
/** Resultado de la edición/reenvío del presupuesto (US-015), discriminado por `clase`. */
export type ResultadoEdicion =
  | { clase: 'edicion'; datos: EdicionPresupuestoResponse }
  | { clase: 'reenvio'; datos: ReenviarPresupuestoResponse };

type Props = {
  presupuesto: ConfirmarPresupuestoResponse | null;
  edicion: ResultadoEdicion | null;
  senal: ConfirmarSenalResponse | null;
  forzar: ForzarInicioEventoResponse | null;
  finalizar: FinalizarEventoResponse | null;
  onCerrarPresupuesto: () => void;
  onCerrarEdicion: () => void;
  onCerrarSenal: () => void;
  onCerrarForzar: () => void;
  onCerrarFinalizar: () => void;
};

export const AvisosEdicionPresupuesto = ({
  presupuesto,
  edicion,
  senal,
  forzar,
  finalizar,
  onCerrarPresupuesto,
  onCerrarEdicion,
  onCerrarSenal,
  onCerrarForzar,
  onCerrarFinalizar,
}: Props) => (
  <>
    {presupuesto && (
      <AvisoPresupuestoConfirmado resultado={presupuesto} onCerrar={onCerrarPresupuesto} />
    )}
    {edicion && <AvisoPresupuestoEditado resultado={edicion} onCerrar={onCerrarEdicion} />}
    {senal && <AvisoReservaConfirmada resultado={senal} onCerrar={onCerrarSenal} />}
    {forzar && <AvisoEventoForzado resultado={forzar} onCerrar={onCerrarForzar} />}
    {finalizar && <AvisoEventoFinalizado resultado={finalizar} onCerrar={onCerrarFinalizar} />}
  </>
);
