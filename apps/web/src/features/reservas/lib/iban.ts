/**
 * Validación de IBAN por checksum módulo 97 (ISO 13616) en cliente, para UX
 * inmediata (US-035 · UC-26/UC-27, FA-01). Es un **espejo** de la regla de dominio
 * del backend (`comunicaciones/domain/validar-iban`): la UI valida antes de enviar
 * para dar feedback sin ida-y-vuelta, pero el servidor **revalida** y es la fuente
 * de verdad (no se confía en la UI). En MVP solo formato/checksum; verificación
 * bancaria en tiempo real está fuera de alcance (design.md §D-4).
 */

/**
 * Longitud total del IBAN por prefijo de país (ISO 13616 registry, subconjunto
 * SEPA/UE + comunes). Si el país no está en la tabla el IBAN se considera inválido
 * (país desconocido), coherente con la regla de dominio del backend.
 */
const LONGITUD_POR_PAIS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22,
  IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
};

/** Normaliza el IBAN: sin espacios ni guiones, en mayúsculas. */
export const normalizarIban = (valor: string): string =>
  valor.replace(/[\s-]+/g, '').toUpperCase();

/**
 * Valida el IBAN por checksum módulo 97. Devuelve `true` solo si:
 *  - Es alfanumérico con prefijo de país de 2 letras + 2 dígitos de control.
 *  - El país es conocido y la longitud total coincide con la del país.
 *  - El resto de mover los 4 primeros al final, convertir letras (A=10…Z=35) y
 *    calcular `mod 97` es exactamente 1.
 */
export const esIbanValido = (valorCrudo: string): boolean => {
  const iban = normalizarIban(valorCrudo);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;

  const pais = iban.slice(0, 2);
  const longitudEsperada = LONGITUD_POR_PAIS[pais];
  if (longitudEsperada === undefined || iban.length !== longitudEsperada) return false;

  // Mover los 4 primeros caracteres al final y convertir letras a números.
  const reordenado = iban.slice(4) + iban.slice(0, 4);
  const numerico = reordenado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // mod 97 por bloques para evitar desbordar Number con enteros muy grandes.
  let resto = 0;
  for (const char of numerico) {
    resto = (resto * 10 + Number(char)) % 97;
  }
  return resto === 1;
};
