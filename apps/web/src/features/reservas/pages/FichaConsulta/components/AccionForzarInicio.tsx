import { Info, Play } from 'lucide-react';
import {
  precondicionesIncumplidas,
  puedeForzarInicioEvento,
} from '../../../lib/forzarInicioEvento';
import type { Reserva } from '../../../model/types';

/**
 * Bloque "Forzar inicio del evento" (US-032 · UC-23 FA-01) de la sección Acciones.
 * Extraído de `AccionesConsulta` para respetar el límite de 300 líneas (regla dura
 * `max-lines`). Visible SOLO cuando la RESERVA está en `reserva_confirmada` Y su
 * `fechaEvento` es hoy (guarda de origen + fecha); fuera de eso no renderiza nada.
 * Muestra la lista de precondiciones incumplidas (derivada en cliente para el aviso;
 * el backend la recalcula bajo el lock) y dispara la doble confirmación (el POST se
 * emite en `ForzarInicioEventoDialog`). El backend revalida (409/422).
 */
const claseBotonAccion =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onForzarInicioEvento: () => void;
};

export const AccionForzarInicio = ({ reserva, onForzarInicioEvento }: Props) => {
  const puedeForzar = puedeForzarInicioEvento(reserva.estado, reserva.fechaEvento, new Date());
  if (!puedeForzar) return null;

  const precondiciones = precondicionesIncumplidas(reserva);

  return (
    <div className="flex flex-col gap-3" data-testid="bloque-forzar-inicio-evento">
      <p className="font-body text-sm text-text-secondary">
        Hoy es el día del evento y sigue en <strong>reserva confirmada</strong>. Si el inicio
        automático no se ha producido por precondiciones pendientes, puedes forzarlo manualmente
        asumiendo el riesgo; quedará registrado en la auditoría.
      </p>
      {precondiciones.length > 0 && (
        <p data-testid="aviso-precondiciones-ficha" className={claseTextoInfo}>
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          Hay {precondiciones.length} precondición(es) sin cumplir. El forzado no las resuelve:
          revísalas antes de continuar.
        </p>
      )}
      <button
        type="button"
        data-testid="boton-forzar-inicio-evento"
        onClick={onForzarInicioEvento}
        className={claseBotonAccion}
      >
        <Play aria-hidden className="size-5" />
        Forzar inicio del evento
      </button>
    </div>
  );
};
