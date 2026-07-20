/**
 * Placeholder de sección conocida pero aún no implementada (US-000A).
 * Cada US posterior (Calendario US-039, Reservas US-042, Métricas US-044)
 * rellenará su slot. Distinto del catch-all "no encontrado" (ruta desconocida).
 *
 * `nombre` identifica la sección; `titulo` es el título de contenedor mostrado
 * (por defecto `nombre`) y DEBE diferir del título del header de la ruta
 * (spec-delta `app-shell` §"Título de contenedor distinto del título del header").
 */
export const SectionPlaceholder = ({ nombre, titulo }: { nombre: string; titulo?: string }) => (
  <section
    data-testid="section-placeholder"
    className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-muted p-12 text-center"
  >
    <h2 className="font-display text-2xl font-medium text-text-primary">{titulo ?? nombre}</h2>
    <p className="font-body text-sm text-text-secondary">
      Esta sección estará disponible próximamente.
    </p>
  </section>
);
