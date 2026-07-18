import { CalendarPlus, CalendarRange } from 'lucide-react';
import { formatearFecha } from '../lib/fecha';
import type { Reserva } from '../model/types';

/**
 * Sección "Fecha del evento" dentro del editor de consulta (US-051 §D-2). La fecha
 * NUNCA se muta por el PATCH del editor: se gestiona por el flujo atómico. Muestra
 * la fecha actual y un botón que, según el sub-estado, dispara "Añadir fecha"
 * (`2a`, sin fecha → `POST /reservas/{id}/fecha`) o "Cambiar fecha" (`2b/2c/2v`,
 * fecha ya bloqueada → `POST /reservas/{id}/cambiar-fecha`). En otros sub-estados
 * (`2d` en cola, terminales) la fecha no es editable aquí.
 */
const claseBoton =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted sm:w-auto';

const SUB_ESTADOS_CON_FECHA = ['2b', '2c', '2v'] as const;

type Props = {
  reserva: Reserva;
  onGestionarFecha: () => void;
};

export const FechaConsultaSeccion = ({ reserva, onGestionarFecha }: Props) => {
  const subEstado = reserva.subEstado;
  const esExploratoria = subEstado === '2a';
  const tieneFechaBloqueada = SUB_ESTADOS_CON_FECHA.includes(
    subEstado as (typeof SUB_ESTADOS_CON_FECHA)[number],
  );
  const editable = esExploratoria || tieneFechaBloqueada;

  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-border-default/40 bg-surface-subtle/40 p-4">
      <span className="font-body text-xs font-medium tracking-[0.48px] text-text-secondary">
        Fecha del evento
      </span>
      <p className="font-body text-base text-text-primary">
        {reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : 'Sin asignar'}
      </p>
      {editable ? (
        <button
          type="button"
          data-testid="boton-gestionar-fecha"
          onClick={onGestionarFecha}
          className={claseBoton}
        >
          {esExploratoria ? (
            <>
              <CalendarPlus aria-hidden className="size-5" />
              Añadir fecha
            </>
          ) : (
            <>
              <CalendarRange aria-hidden className="size-5" />
              Cambiar fecha
            </>
          )}
        </button>
      ) : (
        <p className="font-body text-[13px] text-text-muted">
          La fecha no puede cambiarse en el estado actual de la consulta.
        </p>
      )}
    </div>
  );
};
