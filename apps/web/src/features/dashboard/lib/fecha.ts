/**
 * Formatea una fecha ISO `YYYY-MM-DD` (`fechaEvento`, tipo `date` del contrato,
 * SIN componente horario) a texto corto en español. Se ancla a mediodía UTC
 * para no arrastrar el off-by-one de zona horaria conocido en fechas de
 * solo-día (mismo patrón que `cola-espera/lib/etiquetas`).
 */
export const formatearFechaEvento = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
