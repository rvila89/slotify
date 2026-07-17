import { Link } from 'react-router-dom';
import { Archive, CircleAlert, RotateCw, SearchX, FilterX, CalendarDays, ClipboardList } from 'lucide-react';

const contenedor =
  'flex flex-col items-center gap-3 rounded-[28px] border border-border-default bg-surface-muted p-6 text-center sm:p-10';

/**
 * Estado VACÍO (a) — hay filtros/búsqueda activos pero ningún resultado
 * (US-042 §edge cases). Diferencia búsqueda full-text sin coincidencias (b) de
 * filtros estructurados sin resultados. Ofrece "Limpiar filtros".
 */
export const HistoricoSinResultados = ({
  esBusqueda,
  onLimpiar,
}: {
  esBusqueda: boolean;
  onLimpiar: () => void;
}) => (
  <div className={contenedor} data-testid="historico-sin-resultados">
    <span className="flex size-10 items-center justify-center rounded-full bg-canvas text-brand-primary">
      {esBusqueda ? (
        <SearchX aria-hidden className="size-5" />
      ) : (
        <FilterX aria-hidden className="size-5" />
      )}
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      {esBusqueda
        ? 'La búsqueda no ha encontrado coincidencias'
        : 'No hay reservas en el período seleccionado'}
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      {esBusqueda
        ? 'Prueba con otro término (nombre del cliente, código o notas) o ajusta los filtros.'
        : 'Ninguna reserva cerrada cumple los filtros actuales. Ajusta el rango o límpialos.'}
    </p>
    <button
      type="button"
      onClick={onLimpiar}
      className="mt-1 inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <FilterX aria-hidden className="size-4" />
      Limpiar filtros
    </button>
  </div>
);

/**
 * Estado VACÍO (c) — el tenant aún no tiene ninguna reserva archivada (sin
 * filtros activos y `data: []`). Ofrece accesos directos a Calendario y Pipeline.
 */
export const HistoricoVacio = () => (
  <div className={contenedor} data-testid="historico-vacio">
    <span className="flex size-10 items-center justify-center rounded-full bg-canvas text-brand-primary">
      <Archive aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      Aún no hay reservas archivadas
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      Cuando una reserva se complete o se cancele aparecerá aquí. Mientras tanto,
      revisa la agenda o el pipeline de reservas activas.
    </p>
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
      <Link
        to="/calendario"
        className="inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        <CalendarDays aria-hidden className="size-4" />
        Ir al Calendario
      </Link>
      <Link
        to="/reservas"
        className="inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        <ClipboardList aria-hidden className="size-4" />
        Ir al Pipeline
      </Link>
    </div>
  </div>
);

/**
 * Estado de ERROR — fallo de red/servidor al cargar `GET /historico`.
 * `role="alert"` + botón "Reintentar" cableado al `refetch` de la query.
 */
export const HistoricoError = ({ onRetry }: { onRetry: () => void }) => (
  <div role="alert" className={contenedor} data-testid="historico-error">
    <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
      <CircleAlert aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      No se ha podido cargar el histórico
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      Ha ocurrido un problema al consultar el histórico. Comprueba tu conexión e
      inténtalo de nuevo.
    </p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-1 inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <RotateCw aria-hidden className="size-4" />
      Reintentar
    </button>
  </div>
);
