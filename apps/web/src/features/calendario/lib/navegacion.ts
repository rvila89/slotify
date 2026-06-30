/**
 * Helpers de navegación del calendario (US-039). El enlace a la vista de cola
 * DELEGA en US-017 (fuera de alcance): apuntamos a una ruta estable
 * `/reservas/:id/cola`; mientras US-017 no exista, esa ruta renderiza un stub
 * claramente marcado. Aquí solo construimos la URL — nunca la lógica de cola.
 */
export const rutaCola = (reservaBloqueanteId: string): string =>
  `/reservas/${reservaBloqueanteId}/cola`;

/** Fecha ISO `YYYY-MM-DD` a texto largo en español para el popover/leyenda. */
export const formatearFechaLarga = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
