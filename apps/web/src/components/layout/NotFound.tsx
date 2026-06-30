/**
 * Estado catch-all (US-000A): ruta inexistente DENTRO del shell. Se renderiza en
 * el área de contenido conservando la nav y la cabecera (no es una pantalla
 * aparte). Distinto del placeholder de sección conocida.
 */
export const NotFound = () => (
  <section
    data-testid="not-found"
    className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-muted p-12 text-center"
  >
    <h2 className="font-display text-2xl font-medium text-text-primary">No encontrado</h2>
    <p className="font-body text-sm text-text-secondary">
      La ruta solicitada no existe dentro de la aplicación.
    </p>
  </section>
);
