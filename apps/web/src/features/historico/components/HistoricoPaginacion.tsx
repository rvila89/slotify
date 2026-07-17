import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMetadata } from '../model/types';

type Props = {
  metadata: PaginationMetadata;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
};

const LIMITES = [20, 50, 100] as const;

const botonClass =
  'inline-flex items-center gap-1 rounded-full border border-border-default bg-canvas px-3 py-1.5 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary';

/**
 * Controles de paginación del histórico (US-042). Muestra el rango visible y el
 * total, permite avanzar/retroceder de página (acotado a `[1, totalPages]`) y
 * cambiar `limit` (20/50/100, dentro del rango 1..100 del contrato). El backend
 * es la fuente de verdad: `metadata` viene de la respuesta. Cambiar el límite
 * reinicia a la primera página (lo gestiona la página contenedora).
 */
export const HistoricoPaginacion = ({ metadata, onPageChange, onLimitChange }: Props) => {
  const { page, limit, total, totalPages } = metadata;
  const desde = total === 0 ? 0 : (page - 1) * limit + 1;
  const hasta = Math.min(page * limit, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-xs text-text-secondary" aria-live="polite">
        Mostrando <span className="font-semibold text-text-primary">{desde}</span>–
        <span className="font-semibold text-text-primary">{hasta}</span> de{' '}
        <span className="font-semibold text-text-primary">{total}</span>
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 font-body text-xs text-text-secondary">
          Por página
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="rounded-lg border border-border-default bg-canvas px-2 py-1 font-body text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary"
          >
            {LIMITES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className={botonClass}
          >
            <ChevronLeft aria-hidden className="size-4" />
            Anterior
          </button>
          <span className="font-body text-xs text-text-secondary">
            Página <span className="font-semibold text-text-primary">{page}</span> de{' '}
            <span className="font-semibold text-text-primary">{Math.max(totalPages, 1)}</span>
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className={botonClass}
          >
            Siguiente
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
