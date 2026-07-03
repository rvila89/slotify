import { Users } from 'lucide-react';
import type { ColaItem } from '../model/types';
import { ColaItemFila } from './ColaItemFila';

const claseSeccion =
  'flex flex-col gap-5 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Sección "Cola de espera" (US-017 + US-019): lista de RESERVA en `2.d` ordenada ASC
 * por `posicionCola` (el backend ya la entrega en orden FIFO; no se reordena aquí).
 * FA-01: cola vacía → mensaje "Sin consultas en espera para esta fecha".
 *
 * US-019: si `onPromover` está presente (rol Gestor), cada fila muestra la acción
 * "Promover a bloqueante" que abre el diálogo de confirmación de la página.
 */
type Props = {
  cola: ColaItem[];
  /** Si se provee (Gestor), habilita la acción de promoción manual por fila. */
  onPromover?: (item: ColaItem) => void;
};

export const SeccionCola = ({ cola, onPromover }: Props) => (
  <section className={claseSeccion} aria-labelledby="cola-espera-lista">
    <div className="flex items-center justify-between gap-3">
      <div id="cola-espera-lista" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <Users aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Cola de espera
        </h2>
      </div>
      {cola.length > 0 ? (
        <span className="rounded-full bg-brand-primary/10 px-3 py-1 font-body text-xs font-semibold text-brand-primary">
          {cola.length} en espera
        </span>
      ) : null}
    </div>

    {cola.length === 0 ? (
      <p
        data-testid="cola-vacia"
        className="rounded-2xl border border-dashed border-border-default/40 bg-canvas px-4 py-6 text-center font-body text-sm text-text-secondary"
      >
        Sin consultas en espera para esta fecha.
      </p>
    ) : (
      <ol className="flex flex-col gap-3">
        {cola.map((item) => (
          <ColaItemFila key={item.idReserva} item={item} onPromover={onPromover} />
        ))}
      </ol>
    )}
  </section>
);
