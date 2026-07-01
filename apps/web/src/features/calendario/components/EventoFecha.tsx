import { Repeat } from 'lucide-react';
import type { EventoCalendario } from '../model/types';

/**
 * Render de un evento dentro de react-big-calendar (vistas mes/semana/día). El
 * color de relleno lo aplica `eventPropGetter` (clase `cal-*`) en el contenedor;
 * aquí pintamos el nombre del cliente y, superpuesto, el indicador `🔁 N en cola`
 * cuando `enCola ≥ 1` (US-039 §Happy Path 2º). El indicador NO cambia el color
 * base de la celda; se superpone.
 */
export const EventoFecha = ({ event }: { event: EventoCalendario }) => {
  const { fuente } = event;
  return (
    <span className="flex w-full items-center justify-between gap-1 truncate">
      <span className="truncate">{event.title}</span>
      {fuente.enCola >= 1 ? (
        <span
          className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/25 px-1.5 py-0.5 text-[10px] font-bold leading-none"
          aria-label={`${fuente.enCola} en cola`}
          title={`${fuente.enCola} en cola`}
        >
          <Repeat aria-hidden className="size-2.5" />
          {fuente.enCola}
        </span>
      ) : null}
    </span>
  );
};
