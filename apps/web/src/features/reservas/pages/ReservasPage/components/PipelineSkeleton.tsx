import { COLUMNAS_KANBAN } from '../../../lib/columnasKanban';
import { COLUMNA_BG, COLUMNA_WIDTH_CLASS } from '../constants';

/**
 * Estado de carga del pipeline (US-050 · FA-02, D-5): las 5 columnas con
 * tarjetas fantasma, sin errores de UI. Mismo layout con scroll horizontal que
 * el Kanban real. `data-testid="pipeline-skeleton"` para el test de vista.
 */
export const PipelineSkeleton = () => (
  <div
    data-testid="pipeline-skeleton"
    aria-busy="true"
    aria-live="polite"
    className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 lg:mx-0 lg:px-0"
  >
    <div className="flex gap-4">
      {COLUMNAS_KANBAN.map((columna) => (
        <div
          key={columna.id}
          className={`flex shrink-0 flex-col gap-3 rounded-xl p-4 ${COLUMNA_WIDTH_CLASS}`}
          style={{ backgroundColor: COLUMNA_BG }}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: columna.dotColor }}
            />
            <h3 className="font-display text-sm font-semibold text-text-primary">
              {columna.label}
            </h3>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl bg-canvas p-[17px]">
              <div className="h-4 w-32 animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-surface-muted" />
              <div className="h-1 w-full animate-pulse rounded-full bg-surface-muted" />
              <div className="h-1 w-full animate-pulse rounded-full bg-surface-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);
