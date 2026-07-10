/**
 * Validación de IBAN por checksum módulo 97 (ISO 13616) — REGLA DE DOMINIO PURA
 * (US-035 / UC-26 FA-01, UC-27; design.md §D-4).
 *
 * Función pura (arrow function, sin `@nestjs/*` ni Prisma; hook `no-infra-in-domain`).
 * Precede a TODA escritura del IBAN: si no supera la validación, el caso de uso NO
 * persiste `CLIENTE.iban_devolucion` ni dispara E8, y el endpoint responde 422 (FA-01).
 *
 * Algoritmo mod-97 (ISO 13616):
 *   1. Normalizar (mayúsculas, sin espacios).
 *   2. Validar el patrón país (2 letras) + 2 dígitos de control + BBAN alfanumérico.
 *   3. Validar la longitud por país (p. ej. ES = 24).
 *   4. Mover los 4 primeros caracteres al final.
 *   5. Convertir letras a números (A=10 … Z=35).
 *   6. `mod 97` == 1 ⇒ IBAN válido.
 */

/** Motivo del rechazo de un IBAN (discriminador del resultado inválido). */
export type MotivoIbanInvalido =
  | 'vacio'
  | 'formato_invalido'
  | 'pais_desconocido'
  | 'longitud_incorrecta'
  | 'checksum_invalido';

/** Resultado discriminado de la validación de IBAN. */
export type ResultadoValidacionIban =
  | { valido: true; ibanNormalizado: string }
  | { valido: false; motivo: MotivoIbanInvalido };

/**
 * Longitud total del IBAN por código de país (ISO 13616 / registro SWIFT). En MVP se
 * cubren los países del espacio SEPA más frecuentes; el prefijo no listado se rechaza
 * como `pais_desconocido`. `ES` (España) = 24, el país canónico del spec-delta.
 */
const LONGITUD_POR_PAIS: Readonly<Record<string, number>> = {
  AD: 24,
  AT: 20,
  BE: 16,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
};

/** Normaliza un IBAN candidato: mayúsculas y sin ningún espacio en blanco. */
const normalizarIban = (iban: string): string =>
  iban.replace(/\s+/g, '').toUpperCase();

/** Patrón estructural: país (2 letras) + 2 dígitos de control + BBAN alfanumérico. */
const PATRON_IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/;

/**
 * Calcula `mod 97` sobre el IBAN reordenado (4 primeros al final) con conversión de
 * letras a dígitos (A=10 … Z=35), en pasos para evitar el desbordamiento de enteros.
 */
const modulo97 = (ibanNormalizado: string): number => {
  const reordenado = ibanNormalizado.slice(4) + ibanNormalizado.slice(0, 4);
  let resto = 0;
  for (const caracter of reordenado) {
    const codigo = caracter.charCodeAt(0);
    // '0'-'9' → 0-9 ; 'A'-'Z' → 10-35.
    const valor =
      codigo >= 48 && codigo <= 57
        ? caracter
        : String(codigo - 55);
    for (const digito of valor) {
      resto = (resto * 10 + Number(digito)) % 97;
    }
  }
  return resto;
};

/**
 * Valida un IBAN por checksum mod-97 (normalizando antes). Devuelve un resultado
 * discriminado: `{ valido: true, ibanNormalizado }` o `{ valido: false, motivo }`.
 */
export const validarIban = (iban: string): ResultadoValidacionIban => {
  const normalizado = normalizarIban(iban ?? '');

  if (normalizado.length === 0) {
    return { valido: false, motivo: 'vacio' };
  }

  if (!PATRON_IBAN.test(normalizado)) {
    return { valido: false, motivo: 'formato_invalido' };
  }

  const pais = normalizado.slice(0, 2);
  const longitudEsperada = LONGITUD_POR_PAIS[pais];
  if (longitudEsperada === undefined) {
    return { valido: false, motivo: 'pais_desconocido' };
  }

  if (normalizado.length !== longitudEsperada) {
    return { valido: false, motivo: 'longitud_incorrecta' };
  }

  if (modulo97(normalizado) !== 1) {
    return { valido: false, motivo: 'checksum_invalido' };
  }

  return { valido: true, ibanNormalizado: normalizado };
};

/** Atajo booleano: `true` si el IBAN supera la validación mod-97 (mismo criterio). */
export const esIbanValido = (iban: string): boolean => validarIban(iban).valido;
