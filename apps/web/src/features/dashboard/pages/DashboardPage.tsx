import { useDashboard } from '../api/useDashboard';
import { WidgetCard } from '../components/WidgetCard';
import { DashboardSkeleton } from '../components/DashboardSkeleton';
import { DashboardError } from '../components/DashboardError';
import { WIDGETS_META } from '../lib/widgets';

/**
 * Dashboard operativo (US-044 · UC-34). Vista de LECTURA PURA que proyecta el
 * estado operativo del tenant en 7 widgets desde una única llamada agregada
 * (`GET /dashboard`, design §D-1). El Calendario sigue siendo la landing
 * post-login; este dashboard es una entrada más del shell.
 *
 * Ramas de estado:
 *  - `isLoading` → `DashboardSkeleton` (placeholders de la parrilla).
 *  - `error` → `DashboardError` con reintento (`refetch`).
 *  - datos → parrilla de 7 cards; cada widget gestiona su vacío (§FA-01).
 *
 * Responsive mobile-first (regla dura CLAUDE.md): 1 columna en móvil, 2 en `md`,
 * 3 en `lg`/`xl`; sin anchos fijos ni overflow horizontal. Los tokens y el
 * lenguaje visual (bento cards) provienen del design system del proyecto.
 */
export const DashboardPage = () => {
  const { data, isLoading, isError, refetch } = useDashboard();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Dashboard operativo
        </h1>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Estado operativo del negocio de un vistazo: eventos próximos, pipeline y acciones
          pendientes.
        </p>
      </header>

      {isLoading ? (
        <div aria-busy="true" aria-live="polite">
          <DashboardSkeleton />
        </div>
      ) : isError || !data ? (
        <DashboardError onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WIDGETS_META.map(({ key, titulo, descripcion, vacio }) => {
            const widget = data[key];
            return (
              <WidgetCard
                key={key}
                titulo={titulo}
                descripcion={descripcion}
                vacio={vacio}
                total={widget.total}
                items={widget.items}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
