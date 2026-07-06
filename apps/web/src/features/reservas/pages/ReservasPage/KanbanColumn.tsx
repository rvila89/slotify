import type { Reserva } from '../../model/types';
import type { ColumnaKanban } from '../../lib/columnasKanban';
import { ReservaKanbanCard } from './ReservaKanbanCard';
import { COLUMNA_BG, COLUMNA_WIDTH_CLASS } from './constants';

type KanbanColumnProps = {
  columna: ColumnaKanban;
  reservas: Reserva[];
};

/**
 * Columna del Kanban (US-050 · UC-37): cabecera con dot de color + label +
 * badge de recuento, y la lista de tarjetas de la fase. Ancho fijo de 320px
 * para que en `<lg` el conjunto se desplace horizontalmente y NO se apile
 * (D-6). Tokens del node 0:523 en `constants.ts`.
 */
export const KanbanColumn = ({ columna, reservas }: KanbanColumnProps) => (
  <section
    aria-label={`Columna ${columna.label}`}
    className={`flex shrink-0 flex-col gap-3 rounded-xl p-4 ${COLUMNA_WIDTH_CLASS}`}
    style={{ backgroundColor: COLUMNA_BG }}
  >
    <header className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: columna.dotColor }}
      />
      <h3 className="font-display text-sm font-semibold text-text-primary">{columna.label}</h3>
      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-secondary">
        {reservas.length}
      </span>
    </header>

    <div className="flex flex-col gap-4">
      {reservas.map((reserva) => (
        <ReservaKanbanCard key={reserva.idReserva} reserva={reserva} />
      ))}
    </div>
  </section>
);
