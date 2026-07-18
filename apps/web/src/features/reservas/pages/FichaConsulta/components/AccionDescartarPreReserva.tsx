import { Ban } from 'lucide-react';
import { puedeDescartarPreReserva } from '../../../lib/descartarPreReserva';
import type { Reserva } from '../../../model/types';

/**
 * Bloque de la acción "Descartar pre-reserva" (workstream B de
 * `presupuesto-prereserva-cta-descarte-y-e2`) dentro de la sección "Acciones" de la
 * ficha. Espejo, en fase `pre_reserva`, del descarte manual de una consulta
 * (US-013, `AccionDescartar`): el gestor cierra la pre-reserva a mano —liberando la
 * fecha y promoviendo la cola— sin esperar a la expiración de TTL.
 *
 * Solo se renderiza cuando la RESERVA está en `pre_reserva`; en cualquier otro
 * estado la guarda lo oculta. El backend revalida siempre de forma defensiva (422
 * origen inválido / 409 terminal o carrera perdida).
 *
 * Estilo secundario/destructivo (NO verde): es una acción de cierre negativo, no un
 * CTA de avance de estado; usa el tratamiento de botón outline del sistema, igual
 * que `AccionDescartar` (US-013).
 */
const claseBotonDescartar =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-10 font-display text-base text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

type Props = {
  reserva: Reserva;
  onDescartarPreReserva: () => void;
};

export const AccionDescartarPreReserva = ({ reserva, onDescartarPreReserva }: Props) => {
  if (!puedeDescartarPreReserva({ estado: reserva.estado })) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-sm text-text-secondary">
        Si la pre-reserva no va a prosperar (p. ej. el cliente no paga la señal), descártala:
        pasará a un estado terminal, se liberará la fecha bloqueada y se promoverá la cola de
        espera cuando la haya. Esta acción es irreversible.
      </p>
      <button
        type="button"
        data-testid="boton-descartar-prereserva"
        onClick={onDescartarPreReserva}
        className={claseBotonDescartar}
      >
        <Ban aria-hidden className="size-5" />
        Descartar pre-reserva
      </button>
    </div>
  );
};
