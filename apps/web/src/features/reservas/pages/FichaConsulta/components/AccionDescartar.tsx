import { Info, UserX } from 'lucide-react';
import { MENSAJE_DESCARTE_TERMINAL, puedeDescartarConsulta } from '../../../lib/descartarConsulta';
import type { Reserva } from '../../../model/types';

/**
 * Bloque de la acción "Marcar como descartada por cliente" (US-013 · UC-10, A17
 * manual) dentro de la sección "Acciones" de la ficha. Extraído de
 * `AccionesConsulta` para mantener el contenedor ≤300 líneas (regla dura
 * `max-lines`).
 *
 * Solo se renderiza (por el padre) mientras la RESERVA sigue en fase `consulta`.
 * Ofrece el botón DESHABILITADO con la razón cuando el sub_estado es terminal
 * (`2x/2y/2z`); en los sub_estados no terminales (`2a/2b/2c/2d/2v`) está
 * habilitado. El backend revalida siempre de forma defensiva (409
 * `transicion_no_permitida`).
 *
 * Estilo neutro (no primario): es una acción de cierre negativo del lead, no un
 * CTA de avance de estado; usa el tratamiento de botón secundario del sistema.
 */
const claseBotonDescartar =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-10 font-display text-base text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onDescartarConsulta: () => void;
};

export const AccionDescartar = ({ reserva, onDescartarConsulta }: Props) => {
  const habilitado = puedeDescartarConsulta(reserva.estado, reserva.subEstado);

  return (
    <div className="flex flex-col gap-3">
      {habilitado ? (
        <p className="font-body text-sm text-text-secondary">
          Si el cliente ha comunicado que no continúa, marca la consulta como descartada por
          cliente: pasará a un estado terminal, se liberará la fecha si estaba bloqueada y se
          promoverá la cola de espera cuando la haya. No se envía ningún email.
        </p>
      ) : (
        <p data-testid="aviso-descartar-bloqueado" className={claseTextoInfo}>
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          {MENSAJE_DESCARTE_TERMINAL}
        </p>
      )}
      <button
        type="button"
        data-testid="boton-descartar-consulta"
        onClick={onDescartarConsulta}
        disabled={!habilitado}
        aria-disabled={!habilitado}
        className={claseBotonDescartar}
      >
        <UserX aria-hidden className="size-5" />
        Marcar como descartada por cliente
      </button>
    </div>
  );
};
