import { useState } from 'react';
import { Calendar, type View, type EventPropGetter } from 'react-big-calendar';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import type { EventoCalendario, VistaCalendario } from '../model/types';
import { localizer, mensajes, culture, VISTA_A_RBC, RBC_A_VISTA } from '../lib/localizer';
import { ESTILO_COLOR } from '../lib/colores';
import { EventoFecha } from './EventoFecha';
import { Toolbar } from './Toolbar';
import { DetalleFecha } from './DetalleFecha';

type Props = {
  eventos: EventoCalendario[];
  fecha: Date;
  vista: VistaCalendario;
  onNavigate: (d: Date) => void;
  onVista: (v: VistaCalendario) => void;
};

/**
 * Tablero de react-big-calendar (US-039). Aplica el color canónico vía
 * `eventPropGetter` (clase `cal-*`, idéntica en todas las vistas), monta la
 * toolbar y el render de evento personalizados, y abre el popover de detalle al
 * hacer clic en un evento — reutilizando los datos de la MISMA respuesta (sin
 * segunda llamada). La altura adapta entre móvil y escritorio.
 */
const eventPropGetter: EventPropGetter<EventoCalendario> = (event) => ({
  className: ESTILO_COLOR[event.fuente.color].evento,
});

export const CalendarioBoard = ({ eventos, fecha, vista, onNavigate, onVista }: Props) => {
  const [seleccionada, setSeleccionada] = useState<EventoCalendario | null>(null);

  return (
    <Popover open={Boolean(seleccionada)} onOpenChange={(o) => !o && setSeleccionada(null)}>
      <PopoverAnchor asChild>
        <div className="h-[70vh] min-h-[28rem] lg:h-[calc(100vh-18rem)]">
          <Calendar<EventoCalendario>
          localizer={localizer}
          culture={culture}
          messages={mensajes}
          events={eventos}
          date={fecha}
          view={VISTA_A_RBC[vista]}
          views={['month', 'week', 'day', 'agenda']}
          popup
          startAccessor="start"
          endAccessor="end"
          onNavigate={onNavigate}
          onView={(v: View) => onVista(RBC_A_VISTA[v] ?? 'mes')}
          onSelectEvent={(e) => setSeleccionada(e)}
          eventPropGetter={eventPropGetter}
          components={{ toolbar: Toolbar, event: EventoFecha }}
        />
        </div>
      </PopoverAnchor>

      {seleccionada ? (
        <PopoverContent align="center" side="bottom" sideOffset={-240} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DetalleFecha fecha={seleccionada.fuente} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
};
