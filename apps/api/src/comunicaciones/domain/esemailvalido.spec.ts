/**
 * TESTS de la VALIDACIÓN de EMAIL (RFC 5321 razonable) — REGLA DE DOMINIO PURA
 * (US-046 / UC-36; design.md D-4, tabla del Gate 1 2026-07-17) — fase TDD RED.
 * tasks.md Fase 3: §3.4 (validador de email de dominio en su spec hermano).
 *
 * Trazabilidad: US-046, spec-delta `comunicaciones` Requirement "Validación del
 * destinatario antes del envío deja el borrador en borrador" (Scenario "Email de
 * cliente nulo o inválido bloquea el envío y conserva el borrador") y Requirement
 * "Creación y envío de un email manual …" (Scenario "Email manual con cliente sin
 * email válido bloquea el envío").
 *
 * Es una REGLA DE DOMINIO PURA (arrow function, sin `@nestjs/*` ni Prisma; hook
 * `no-infra-in-domain`), imitando el patrón de `validar-iban.ts`. La invoca el
 * use-case ANTES del puerto de envío (D-4, Opción A): si el destinatario no es
 * válido, NO se llama al proveedor y la fila NO cambia de estado.
 *
 * Contrato del símbolo esperado (a implementar por `backend-developer` en
 * `comunicaciones/domain/esemailvalido.ts`):
 *
 *   - `esEmailValido(email: string | null | undefined): boolean`
 *       `true` sólo si `email` no es nulo/vacío y tiene formato RFC 5321 razonable.
 *       Nulo, `undefined`, cadena vacía o sólo espacios ⇒ `false`.
 *
 * RED: aún NO existe `comunicaciones/domain/esemailvalido.ts`. Los imports fallan y
 * la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import { esEmailValido } from './esemailvalido';

// ===========================================================================
// Emails VÁLIDOS (RFC 5321 razonable).
// ===========================================================================

describe('esEmailValido — direcciones válidas', () => {
  const validos = [
    'marta.soler@example.com',
    'ada@us035.test',
    'nombre+etiqueta@dominio.co',
    'a@b.io',
    'usuario_con-guion@sub.dominio.example.com',
    'MAYUSCULAS@EXAMPLE.COM',
    "o'brien@example.com",
    'con.puntos.varios@example.com',
  ];

  it.each(validos)('debe_aceptar_%s_como_email_valido', (email) => {
    expect(esEmailValido(email)).toBe(true);
  });
});

// ===========================================================================
// Emails INVÁLIDOS por formato.
// ===========================================================================

describe('esEmailValido — formato inválido', () => {
  const invalidos = [
    'sin-arroba.example.com',
    '@sin-local.com',
    'sin-dominio@',
    'espacio en@medio.com',
    'doble@@arroba.com',
    'sin-tld@dominio',
    'punto-final@dominio.com.',
    'trailing space@x.com ',
    'texto suelto que no es email',
  ];

  it.each(invalidos)('debe_rechazar_%s_por_formato_invalido', (email) => {
    expect(esEmailValido(email)).toBe(false);
  });
});

// ===========================================================================
// Nulo / undefined / vacío — el destinatario "no existe": DEBE rechazarse.
// (spec-delta: `destinatario_email` / `CLIENTE.email` NO NULO antes de enviar.)
// ===========================================================================

describe('esEmailValido — nulo, undefined y vacío', () => {
  it('debe_rechazar_null', () => {
    expect(esEmailValido(null)).toBe(false);
  });

  it('debe_rechazar_undefined', () => {
    expect(esEmailValido(undefined)).toBe(false);
  });

  it('debe_rechazar_la_cadena_vacia', () => {
    expect(esEmailValido('')).toBe(false);
  });

  it('debe_rechazar_una_cadena_solo_de_espacios', () => {
    expect(esEmailValido('   ')).toBe(false);
  });
});
