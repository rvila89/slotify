import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowUpToLine } from 'lucide-react';
import type { ColaItem } from '../model/types';

/**
 * Fila de una RESERVA en cola (US-017 + US-019): posición FIFO, cliente, código y
 * tiempo en cola. `tiempoEnCola` viene ya derivado del backend como string legible: se
 * muestra TAL CUAL, sin recalcular en cliente. El bloque cliente/código enlaza a la
 * ficha de la reserva (`GET /reservas/{id}`), objetivo táctil amplio para móvil.
 *
 * US-019: cuando `onPromover` está presente (Gestor), la fila muestra la acción
 * "Promover a bloqueante" como botón HERMANO del enlace (no anidado: un botón dentro
 * de un `<a>` es HTML inválido). El disparo abre el diálogo de confirmación destructiva
 * de la página; NO ejecuta la promoción directamente.
 *
 * Responsive: en `<sm` la fila apila el contenido y la acción a ancho completo; en
 * `sm+` va en línea. Objetivos táctiles ≥ 44px, sin overflow horizontal.
 */
type Props = {
  item: ColaItem;
  /** Si se provee (rol Gestor), muestra la acción "Promover a bloqueante". */
  onPromover?: (item: ColaItem) => void;
};

export const ColaItemFila = ({ item, onPromover }: Props) => (
  <li className="flex flex-col gap-2 rounded-2xl border border-border-default/20 bg-canvas p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
    <Link
      to={`/reservas/${item.idReserva}`}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:gap-4"
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

      <span className="hidden shrink-0 items-center gap-1 font-body text-xs font-semibold text-text-secondary transition-colors group-hover:text-brand-primary sm:flex">
        Ver ficha
        <ArrowUpRight aria-hidden className="size-4" />
      </span>
    </Link>

    {onPromover ? (
      <button
        type="button"
        onClick={() => onPromover(item)}
        data-testid={`promover-${item.idReserva}`}
        className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-full border border-brand-primary/40 bg-brand-primary/5 px-4 font-body text-xs font-semibold text-brand-primary transition hover:bg-brand-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:h-9 sm:w-auto"
      >
        <ArrowUpToLine aria-hidden className="size-4" />
        Promover a bloqueante
      </button>
    ) : null}
  </li>
);
