/**
 * TESTS de la VALIDACIÓN IBAN por checksum módulo 97 (ISO 13616) — fase TDD RED.
 * US-035 / UC-26 (FA-01), UC-27; tasks.md Fase 3: §3.1. design.md §D-4.
 *
 * Es una REGLA DE DOMINIO PURA (arrow function, sin `@nestjs/*` ni Prisma; hook
 * `no-infra-in-domain`). Precede a TODA escritura del IBAN: si el IBAN no supera la
 * validación mod-97, el caso de uso NO persiste `CLIENTE.iban_devolucion` ni dispara E8, y
 * el endpoint responde 422 (FA-01). Aquí solo se fija el NÚCLEO PURO de la validación; la
 * orquestación guardar↔E8 se cubre en `registrar-iban-devolucion.use-case.spec.ts`.
 *
 * Contrato del símbolo esperado (a implementar por `backend-developer` en
 * `comunicaciones/domain/validar-iban.ts`):
 *
 *   - `validarIban(iban: string): ResultadoValidacionIban`
 *       Resultado discriminado: `{ valido: true; ibanNormalizado: string }`
 *       o `{ valido: false; motivo: MotivoIbanInvalido }`.
 *       Normaliza (mayúsculas, sin espacios) ANTES de validar; el `ibanNormalizado`
 *       del caso válido es el valor que se persiste.
 *   - `esIbanValido(iban: string): boolean` — atajo booleano (mismo criterio), útil para
 *       la guarda pura del use-case y la revalidación en cliente.
 *
 * Algoritmo mod-97 (ISO 13616): normalizar → validar prefijo país (2 letras) + 2 dígitos de
 * control + BBAN alfanumérico → validar longitud por país (ES = 24) → mover los 4 primeros
 * caracteres al final → convertir letras a números (A=10 … Z=35) → `mod 97` == 1.
 *
 * RED: aún NO existe `comunicaciones/domain/validar-iban.ts`. Los imports fallan y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  validarIban,
  esIbanValido,
  type ResultadoValidacionIban,
} from './validar-iban';

// IBAN español de prueba canónico del spec-delta / contrato (mod-97 válido, 24 chars).
const IBAN_ES_VALIDO = 'ES9121000418450200051332';

// ===========================================================================
// Happy path — IBAN español válido.
// ===========================================================================

describe('validarIban — IBAN español válido (happy path)', () => {
  it('debe_aceptar_un_iban_espanol_valido_y_devolverlo_normalizado', () => {
    const resultado = validarIban(IBAN_ES_VALIDO);

    expect(resultado.valido).toBe(true);
    // El resultado válido lleva el IBAN normalizado (mayúsculas, sin espacios) que se persiste.
    expect((resultado as Extract<ResultadoValidacionIban, { valido: true }>).ibanNormalizado).toBe(
      IBAN_ES_VALIDO,
    );
  });

  it('debe_devolver_true_desde_el_atajo_booleano_para_un_iban_valido', () => {
    expect(esIbanValido(IBAN_ES_VALIDO)).toBe(true);
  });
});

// ===========================================================================
// IBAN con espacios normalizables — debe aceptarse tras normalizar.
// ===========================================================================

describe('validarIban — normalización de espacios y minúsculas', () => {
  it('debe_aceptar_un_iban_con_espacios_agrupados_y_normalizarlo_sin_espacios', () => {
    // Formato "impreso" habitual en grupos de 4; debe normalizarse a mayúsculas sin espacios.
    const conEspacios = 'ES91 2100 0418 4502 0005 1332';

    const resultado = validarIban(conEspacios);

    expect(resultado.valido).toBe(true);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: true }>).ibanNormalizado).toBe(
      IBAN_ES_VALIDO,
    );
  });

  it('debe_aceptar_un_iban_en_minusculas_normalizando_a_mayusculas', () => {
    const resultado = validarIban('es9121000418450200051332');

    expect(resultado.valido).toBe(true);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: true }>).ibanNormalizado).toBe(
      IBAN_ES_VALIDO,
    );
  });

  it('debe_aceptar_un_iban_con_espacios_iniciales_y_finales', () => {
    expect(esIbanValido('  ES9121000418450200051332  ')).toBe(true);
  });
});

// ===========================================================================
// Longitud incorrecta — rechazo.
// ===========================================================================

describe('validarIban — longitud incorrecta por país', () => {
  it('debe_rechazar_un_iban_espanol_demasiado_corto', () => {
    // ES exige 24 caracteres; este tiene menos.
    const resultado = validarIban('ES912100041845020005133');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'longitud_incorrecta',
    );
    expect(esIbanValido('ES912100041845020005133')).toBe(false);
  });

  it('debe_rechazar_un_iban_espanol_demasiado_largo', () => {
    // ES exige 24 caracteres; este tiene 25 (un dígito de más).
    const resultado = validarIban('ES91210004184502000513320');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'longitud_incorrecta',
    );
  });
});

// ===========================================================================
// Dígitos de control (checksum mod-97) incorrectos — rechazo.
// ===========================================================================

describe('validarIban — dígitos de control (checksum mod-97) incorrectos', () => {
  it('debe_rechazar_un_iban_con_longitud_y_formato_correctos_pero_checksum_invalido', () => {
    // Mismo BBAN que el válido pero con los 2 dígitos de control alterados (91 -> 92):
    // longitud y formato OK, pero `mod 97 != 1`.
    const resultado = validarIban('ES9221000418450200051332');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'checksum_invalido',
    );
    expect(esIbanValido('ES9221000418450200051332')).toBe(false);
  });

  it('debe_rechazar_un_iban_todo_ceros_de_longitud_correcta', () => {
    // Longitud ES (24) y formato válidos, pero `mod 97 != 1`.
    const resultado = validarIban('ES0000000000000000000000');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'checksum_invalido',
    );
  });
});

// ===========================================================================
// Código de país desconocido — rechazo.
// ===========================================================================

describe('validarIban — código de país desconocido', () => {
  it('debe_rechazar_un_prefijo_de_pais_no_reconocido', () => {
    // "ZZ" no es un país ISO con longitud IBAN registrada.
    const resultado = validarIban('ZZ9121000418450200051332');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'pais_desconocido',
    );
    expect(esIbanValido('ZZ9121000418450200051332')).toBe(false);
  });
});

// ===========================================================================
// Caracteres no alfanuméricos — rechazo.
// ===========================================================================

describe('validarIban — caracteres no alfanuméricos', () => {
  it('debe_rechazar_un_iban_con_guiones_u_otros_simbolos', () => {
    const resultado = validarIban('ES91-2100-0418-4502-0005-1332');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'formato_invalido',
    );
    expect(esIbanValido('ES91-2100-0418-4502-0005-1332')).toBe(false);
  });

  it('debe_rechazar_un_valor_claramente_no_iban', () => {
    // Valor "basura" del spec-delta (FA-01): no cumple el patrón país+control+BBAN.
    const resultado = validarIban('ES12345INVALIDO');

    expect(resultado.valido).toBe(false);
    // No es necesario fijar el motivo exacto entre formato/longitud; basta con que sea inválido.
    expect(esIbanValido('ES12345INVALIDO')).toBe(false);
  });
});

// ===========================================================================
// Cadena vacía — rechazo.
// ===========================================================================

describe('validarIban — cadena vacía', () => {
  it('debe_rechazar_la_cadena_vacia', () => {
    const resultado = validarIban('');

    expect(resultado.valido).toBe(false);
    expect((resultado as Extract<ResultadoValidacionIban, { valido: false }>).motivo).toBe(
      'vacio',
    );
    expect(esIbanValido('')).toBe(false);
  });

  it('debe_rechazar_una_cadena_solo_de_espacios', () => {
    expect(esIbanValido('     ')).toBe(false);
    expect(validarIban('     ').valido).toBe(false);
  });
});
