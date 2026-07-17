/**
 * Placeholder de carga del histórico (US-042): filas apiladas neutras mientras
 * llega la primera página. Con `keepPreviousData` solo se ve en la carga inicial;
 * al paginar/filtrar la tabla previa permanece visible.
 */
export const HistoricoSkeleton = () => (
  <div className="flex flex-col gap-3" aria-hidden data-testid="historico-skeleton">
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="h-14 animate-pulse rounded-xl border border-border-default bg-surface-muted"
      />
    ))}
  </div>
);
