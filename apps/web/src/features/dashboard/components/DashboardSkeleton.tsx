/**
 * Skeleton de carga del dashboard (US-044). Reproduce la parrilla de 7 cards con
 * placeholders animados mientras `useDashboard` está en `isLoading`, para evitar
 * saltos de layout al llegar los datos. Mismo grid responsive que la página real
 * (1 / 2 / 3 columnas). Decorativo: `aria-hidden` + estado de carga anunciado por
 * la página vía `aria-busy`.
 */
const SKELETON_CARDS = Array.from({ length: 7 });

const SkeletonCard = () => (
  <div className="flex h-full flex-col gap-4 rounded-[28px] border border-border-default bg-surface-muted p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div className="flex w-full flex-col gap-2">
        <div className="h-3 w-2/3 rounded-full bg-surface-subtle" />
        <div className="h-2.5 w-5/6 rounded-full bg-surface-subtle" />
      </div>
      <div className="h-9 w-10 shrink-0 rounded-lg bg-surface-subtle" />
    </div>
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-11 w-full rounded-2xl bg-surface-subtle" />
      ))}
    </div>
  </div>
);

export const DashboardSkeleton = () => (
  <div
    aria-hidden
    className="grid animate-pulse grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    data-testid="dashboard-skeleton"
  >
    {SKELETON_CARDS.map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);
