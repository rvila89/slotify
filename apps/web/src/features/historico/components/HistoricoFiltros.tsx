import { Search } from 'lucide-react';
import type { EstadoFinal, FiltrosHistorico, TipoEvento } from '../model/types';
import {
  ESTADO_FINAL_OPCIONES,
  TIPO_EVENTO_OPCIONES,
} from '../lib/constants';
import { hayFiltrosActivos } from '../lib/filtros';
import { CAMPO_CLASS, ETIQUETA_CLASS } from '../lib/estilos';

type Props = {
  filtros: FiltrosHistorico;
  onCambiar: (parcial: Partial<FiltrosHistorico>) => void;
  onLimpiar: () => void;
};

/**
 * Barra de búsqueda full-text (`q`) + filtros estructurados del histórico
 * (US-042 · D-3): estado final (default solo completadas, opt-in canceladas),
 * rango de fechas de evento, tipo de evento y rango de importe. Todos los
 * cambios reinician a `page: 1` (nuevo conjunto de resultados). Componente
 * controlado: no tiene estado propio, lo eleva a la página. Responsive: grid de
 * una columna en móvil que crece a varias en `md`/`lg`.
 */
export const HistoricoFiltros = ({ filtros, onCambiar, onLimpiar }: Props) => {
  const activos = hayFiltrosActivos(filtros);

  return (
    <section
      aria-label="Búsqueda y filtros del histórico"
      className="flex flex-col gap-4 rounded-[20px] border border-border-default bg-surface-subtle/40 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="historico-q" className={ETIQUETA_CLASS}>
          Buscar
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          />
          <input
            id="historico-q"
            type="search"
            inputMode="search"
            placeholder="Cliente, código o notas…"
            value={filtros.q ?? ''}
            onChange={(e) => onCambiar({ q: e.target.value, page: 1 })}
            className={`${CAMPO_CLASS} pl-9`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="historico-estado" className={ETIQUETA_CLASS}>
            Estado final
          </label>
          <select
            id="historico-estado"
            value={filtros.estadoFinal ?? ''}
            onChange={(e) =>
              onCambiar({
                estadoFinal: (e.target.value || undefined) as EstadoFinal | undefined,
                page: 1,
              })
            }
            className={CAMPO_CLASS}
          >
            <option value="">Solo completadas</option>
            {ESTADO_FINAL_OPCIONES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="historico-tipo" className={ETIQUETA_CLASS}>
            Tipo de evento
          </label>
          <select
            id="historico-tipo"
            value={filtros.tipoEvento ?? ''}
            onChange={(e) =>
              onCambiar({
                tipoEvento: (e.target.value || undefined) as TipoEvento | undefined,
                page: 1,
              })
            }
            className={CAMPO_CLASS}
          >
            <option value="">Todos</option>
            {TIPO_EVENTO_OPCIONES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className={ETIQUETA_CLASS}>Fecha del evento</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Fecha desde"
              value={filtros.fechaDesde ?? ''}
              onChange={(e) => onCambiar({ fechaDesde: e.target.value, page: 1 })}
              className={CAMPO_CLASS}
            />
            <span aria-hidden className="text-text-muted">
              –
            </span>
            <input
              type="date"
              aria-label="Fecha hasta"
              value={filtros.fechaHasta ?? ''}
              onChange={(e) => onCambiar({ fechaHasta: e.target.value, page: 1 })}
              className={CAMPO_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className={ETIQUETA_CLASS}>Importe (€)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label="Importe mínimo"
              placeholder="Mín."
              value={filtros.importeMin ?? ''}
              onChange={(e) => onCambiar({ importeMin: e.target.value, page: 1 })}
              className={CAMPO_CLASS}
            />
            <span aria-hidden className="text-text-muted">
              –
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label="Importe máximo"
              placeholder="Máx."
              value={filtros.importeMax ?? ''}
              onChange={(e) => onCambiar({ importeMax: e.target.value, page: 1 })}
              className={CAMPO_CLASS}
            />
          </div>
        </div>
      </div>

      {activos && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onLimpiar}
            className="font-body text-xs font-semibold text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </section>
  );
};
