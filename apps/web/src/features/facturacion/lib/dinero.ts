/**
 * Formato monetario para el dominio de facturación (US-022). Los importes viajan
 * como `Importe`/`Porcentaje` del contrato = **string decimal** (p. ej. "484.00")
 * para no perder precisión; aquí solo se formatean para mostrar, nunca se opera
 * con ellos en cliente (el desglose fiscal lo calcula el backend: `baseImponible`,
 * `ivaImporte`, `total` ya vienen congelados y cuadran `base + iva = total`).
 */

/** Formatea un `Importe` (string decimal) o número a euros en español. */
export const formatearEuros = (importe?: string | number | null): string => {
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

/** Formatea un `Porcentaje` (string decimal, p. ej. "21.00") como "21 %". */
export const formatearPorcentaje = (porcentaje?: string | number | null): string => {
  if (porcentaje === null || porcentaje === undefined || porcentaje === '') return '—';
  const valor = typeof porcentaje === 'number' ? porcentaje : Number(porcentaje);
  if (!Number.isFinite(valor)) return '—';
  const texto = Number.isInteger(valor)
    ? String(valor)
    : valor.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${texto} %`;
};
