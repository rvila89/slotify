import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ToolbarProps, View } from 'react-big-calendar';
import { cn } from '@/lib/utils';
import type { EventoCalendario, VistaCalendario } from '../model/types';
import { RBC_A_VISTA } from '../lib/localizer';

/**
 * Toolbar responsive del calendario (US-039 §Cambio de vista / navegación entre
 * períodos). Sustituye la toolbar por defecto de react-big-calendar para:
 *  - usar tokens del proyecto (sin hex inline),
 *  - botones con objetivos táctiles accesibles (≥ 44px),
 *  - mobile-first: navegación + título en una fila, selector de vista debajo en
 *    móvil (`flex-col`) y en línea en `sm`.
 */
const VISTAS: { rbc: View; etiqueta: string }[] = [
  { rbc: 'month', etiqueta: 'Mes' },
  { rbc: 'week', etiqueta: 'Semana' },
  { rbc: 'day', etiqueta: 'Día' },
  { rbc: 'agenda', etiqueta: 'Lista' },
];

const claseNav =
  'flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-muted text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary';

export const Toolbar = ({
  label,
  view,
  onNavigate,
  onView,
}: ToolbarProps<EventoCalendario, object> & {
  onVistaChange?: (v: VistaCalendario) => void;
}) => (
  <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Período anterior" className={claseNav} onClick={() => onNavigate('PREV')}>
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <button type="button" aria-label="Período siguiente" className={claseNav} onClick={() => onNavigate('NEXT')}>
        <ChevronRight aria-hidden className="size-5" />
      </button>
      <button
        type="button"
        className="h-11 rounded-full border border-border-default bg-surface-muted px-4 font-body text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        onClick={() => onNavigate('TODAY')}
      >
        Hoy
      </button>
      <h2 className="ml-1 truncate font-display text-lg font-medium capitalize text-text-primary">{label}</h2>
    </div>

    <div role="tablist" aria-label="Vista del calendario" className="flex rounded-full border border-border-default bg-surface-muted p-1">
      {VISTAS.map(({ rbc, etiqueta }) => (
        <button
          key={rbc}
          type="button"
          role="tab"
          aria-selected={view === rbc}
          className={cn(
            'h-9 flex-1 rounded-full px-3 font-body text-xs font-semibold transition-colors sm:flex-none sm:text-sm',
            view === rbc
              ? 'bg-brand-primary text-brand-foreground'
              : 'text-text-secondary hover:bg-surface-subtle',
          )}
          onClick={() => onView(rbc)}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  </div>
);

/** Re-exporta el mapa RBC→contrato para que la página sincronice la `vista`. */
export { RBC_A_VISTA };
