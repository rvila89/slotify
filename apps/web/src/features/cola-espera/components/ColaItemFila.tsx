import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { ColaItem } from '../model/types';

/**
 * Fila de una RESERVA en cola (US-017): posición FIFO, cliente, código y tiempo
 * en cola. `tiempoEnCola` viene ya derivado del backend como string legible: se
 * muestra TAL CUAL, sin recalcular en cliente. Toda la fila enlaza a la ficha de
 * la reserva (`GET /reservas/{id}`), objetivo táctil amplio para móvil.
 */
export const ColaItemFila = ({ item }: { item: ColaItem }) => (
  <li>
    <Link
      to={`/reservas/${item.idReserva}`}
      className="group flex items-center gap-3 rounded-2xl border border-border-default/20 bg-canvas p-3 transition-colors hover:bg-surface-subtle/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:gap-4 sm:p-4"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 font-display text-sm font-semibold text-brand-primary sm:size-10"
      >
        {item.posicionCola}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate font-body text-sm font-semibold text-text-primary sm:text-base">
          {item.clienteNombre}
        </p>
        <p className="truncate font-body text-xs text-text-secondary">
          {item.codigo}
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          <span>En cola: {item.tiempoEnCola ?? '—'}</span>
        </p>
      </div>

      <span className="flex shrink-0 items-center gap-1 font-body text-xs font-semibold text-text-secondary transition-colors group-hover:text-brand-primary">
        <span className="hidden sm:inline">Ver ficha</span>
        <ArrowUpRight aria-hidden className="size-4" />
      </span>
    </Link>
  </li>
);
