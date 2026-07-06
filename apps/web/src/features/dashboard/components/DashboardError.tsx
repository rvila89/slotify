import { CircleAlert, RotateCw } from 'lucide-react';

/**
 * Estado de error del dashboard (US-044): fallo de red/servidor al cargar el
 * endpoint agregado. Ofrece reintento explícito (`onRetry`, cableado al
 * `refetch` de la query en la página). Mismo lenguaje visual que los estados de
 * error de otras vistas (`cola-espera/EstadosCola`).
 */
export const DashboardError = ({ onRetry }: { onRetry: () => void }) => (
  <div
    role="alert"
    data-testid="dashboard-error"
    className="flex flex-col items-center gap-3 rounded-[28px] border border-border-default bg-surface-muted p-6 text-center sm:p-10"
  >
    <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
      <CircleAlert aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      No se ha podido cargar el dashboard
    </p>
    <p className="max-w-sm font-body text-sm text-text-secondary">
      Ha ocurrido un problema al cargar el estado operativo. Comprueba tu conexión e
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
