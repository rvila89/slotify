/**
 * Helper de fecha del dominio de firma de condiciones particulares (US-024). La
 * fecha de firma llega como `date-time` ISO (`condPartFechaFirma`); se muestra en
 * español con día y hora. El servidor es la fuente de verdad del timestamp.
 */

/** Formatea un instante ISO `date-time` a texto largo en español (día + hora). */
export const formatearFechaHora = (iso?: string | null): string => {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
