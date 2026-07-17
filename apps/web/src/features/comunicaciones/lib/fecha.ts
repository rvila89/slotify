/**
 * Helpers de fecha del dominio de comunicaciones (US-046 · UC-36). `fechaCreacion` y
 * `fechaEnvio` llegan como date-time ISO del contrato; se muestran en español con
 * fecha y hora (la hora sí importa para el log de comunicaciones). El servidor es la
 * fuente de verdad de las marcas temporales.
 */

/** Formatea una fecha-hora ISO (date-time) a fecha + hora larga en español. */
export const formatearFechaHora = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
