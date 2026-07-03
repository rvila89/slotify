/**
 * Helpers de formato monetario para el dominio de presupuestos (US-014). Los
 * importes viajan como `Importe` del contrato = **string decimal** (p. ej.
 * "1210.00") para no perder precisión; aquí solo se formatean para mostrar, nunca
 * se opera con ellos en cliente (los cálculos son del motor de tarifa en backend).
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
