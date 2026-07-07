import { Link } from 'react-router-dom';
import { CalendarPlus, CircleAlert, RotateCw } from 'lucide-react';

/**
 * Estado VACÍO del pipeline (US-050 · FA-01, D-5): sin reservas activas para el
 * tenant. Ofrece un CTA "Nueva Reserva" (enlace a `/reservas/nueva`).
 */
export const PipelineVacio = () => (
  <div className="flex flex-col items-center gap-3 rounded-[28px] border border-border-default bg-surface-muted p-6 text-center sm:p-10">
    <span className="flex size-10 items-center justify-center rounded-full bg-canvas text-brand-primary">
      <CalendarPlus aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      Aún no hay reservas activas
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      Cuando registres una consulta o reserva aparecerá aquí, agrupada por fase del pipeline.
    </p>
    <Link
      to="/reservas/nueva"
      className="mt-1 inline-flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2 font-body text-sm font-semibold text-brand-foreground transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <CalendarPlus aria-hidden className="size-4" />
      Nueva Reserva
    </Link>
  </div>
);

/**
 * Estado de ERROR del pipeline (US-050 · FA-03, D-5): fallo de red/servidor al
 * cargar `GET /reservas`. `role="alert"` + botón "Reintentar" cableado al
 * `refetch` de la query.
 */
export const PipelineError = ({ onRetry }: { onRetry: () => void }) => (
  <div
    role="alert"
    className="flex flex-col items-center gap-3 rounded-[28px] border border-border-default bg-surface-muted p-6 text-center sm:p-10"
  >
    <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
      <CircleAlert aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      No se han podido cargar las reservas
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      Ha ocurrido un problema al cargar el pipeline. Comprueba tu conexión e inténtalo de nuevo.
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
