/**
 * Helpers de presentación del histórico. Reutilizan las convenciones del
 * proyecto: fechas ISO `YYYY-MM-DD` formateadas en español e importes `Importe`
 * (string decimal del contrato) formateados a euros sin operar con ellos.
 */

/** Nombre completo del cliente a partir de nombre + apellidos (fila ligera). */
export const nombreCliente = (
  nombre?: string | null,
  apellidos?: string | null,
): string => {
  const completo = `${nombre ?? ''} ${apellidos ?? ''}`.trim();
  return completo || '—';
};

/** Formatea una fecha ISO `YYYY-MM-DD` a texto largo en español, o `—`. */
export const formatearFechaEvento = (iso?: string | null): string => {
  if (!iso) return '—';
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/**
 * Formatea un `Importe` (string decimal, p. ej. "1210.00") a euros en español.
 * No opera con el valor: solo lo presenta. Devuelve `—` para nulos/no numéricos.
 */
export const formatearImporte = (importe?: string | number | null): string => {
  if (importe === null || importe === undefined || importe === '') return '—';
  const valor = typeof importe === 'number' ? importe : Number(importe);
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
