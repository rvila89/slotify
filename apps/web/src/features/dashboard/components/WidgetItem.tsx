import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { ColorCalendario } from '@/features/calendario';
import { formatearFechaEvento } from '../lib/fecha';
import { ColorDot } from './ColorDot';

/**
 * Fila de un ítem de widget del dashboard (US-044 §FA-02). Enlaza a la ficha de
 * la RESERVA (`/reservas/:reservaId`) como link interno de la SPA —se construye
 * desde `reservaId`, no desde el campo `enlace` del contrato, para garantizar
 * navegación cliente sin recarga—. Muestra código, cliente y fecha del evento.
 *
 * Si recibe `color` (widget `proximos30Dias`), antepone el punto cromático
 * canónico del calendario.
 */
export const WidgetItem = ({
  reservaId,
  codigo,
  clienteNombre,
  fechaEvento,
  color,
}: {
  reservaId: string;
  codigo: string;
  clienteNombre: string;
  fechaEvento: string | null;
  color?: ColorCalendario;
}) => (
  <li>
    <Link
      to={`/reservas/${reservaId}`}
      className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      {color ? <ColorDot color={color} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className="shrink-0 font-body text-xs font-bold uppercase tracking-wide text-brand-primary">
            {codigo}
          </span>
          <span className="truncate font-body text-sm font-semibold text-text-primary">
            {clienteNombre}
          </span>
        </span>
        <span className="font-body text-xs text-text-secondary">
          {formatearFechaEvento(fechaEvento)}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  </li>
);
