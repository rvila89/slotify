/**
 * Helpers de fecha del dominio de facturación (US-030 · cobro de fianza). Las fechas
 * `YYYY-MM-DD` (tipo `date` del contrato) comparan lexicográficamente == cronológicamente,
 * lo que evita problemas de zona horaria al acotar el selector de la fecha de cobro
 * (`fechaCobro ≤ fechaEvento`). El servidor es la fuente de verdad de la validación.
 */

const aISODate = (d: Date): string => {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/** Hoy en formato ISO `YYYY-MM-DD` (zona local). Valor por defecto de la fecha de cobro. */
export const hoyISO = (): string => aISODate(new Date());

/** Formatea una fecha ISO `YYYY-MM-DD` a texto largo en español (para mostrar). */
export const formatearFecha = (iso?: string | null): string => {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};
