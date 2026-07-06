/**
 * Formatea una fecha ISO `YYYY-MM-DD` (`fechaEvento`, tipo `date` del contrato,
 * SIN componente horario) a texto corto en español. Se ancla a mediodía UTC
 * para no arrastrar el off-by-one de zona horaria conocido en fechas de
 * solo-día (mismo patrón que `cola-espera/lib/etiquetas`).
 *
 * `fechaEvento` es nullable en el contrato: las reservas sin fecha asignada
 * (p.ej. estado 2a) llegan como `null`; en ese caso se muestra "Sin fecha" en
 * lugar de un `Invalid Date`.
 */
export const formatearFechaEvento = (iso: string | null): string =>
  iso === null
    ? 'Sin fecha'
    : new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
