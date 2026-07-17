/**
 * Validación de EMAIL (RFC 5321 razonable) — REGLA DE DOMINIO PURA
 * (US-046 / UC-36; design.md D-4, tabla del Gate 1 2026-07-17).
 *
 * Función pura (arrow function, sin `@nestjs/*` ni Prisma; hook `no-infra-in-domain`),
 * imitando el patrón de `validar-iban.ts`. La invoca el use-case ANTES del puerto de
 * envío (D-4, Opción A): si el destinatario no es válido, NO se llama al proveedor y
 * la fila NO cambia de estado (el borrador PERMANECE en `borrador`).
 *
 * No pretende cubrir el 100% de la BNF de RFC 5321/5322 (imposible sin un parser
 * completo), sino una validación RAZONABLE y estricta para un destinatario de negocio:
 *   - Un único `@` que separa parte local y dominio, ambos no vacíos.
 *   - Sin espacios en blanco en ninguna parte.
 *   - Parte local con caracteres habituales (alfanuméricos, `.`, `_`, `%`, `+`, `-`,
 *     `'`), sin punto inicial/final ni puntos consecutivos.
 *   - Dominio con al menos una etiqueta + TLD alfabético de 2+ caracteres, sin punto
 *     final ni etiquetas vacías.
 * Nulo, `undefined`, cadena vacía o sólo espacios ⇒ `false`.
 */

/** Longitudes máximas razonables (RFC 5321): 64 (local), 255 (dominio), 254 (total). */
const MAX_LOCAL = 64;
const MAX_DOMINIO = 255;
const MAX_TOTAL = 254;

/** Parte local: caracteres permitidos, sin punto inicial/final ni puntos dobles. */
const PATRON_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/** Dominio: etiquetas alfanuméricas (con guiones internos) + TLD alfabético 2+. */
const PATRON_DOMINIO =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/**
 * `true` sólo si `email` no es nulo/vacío y tiene un formato RFC 5321 razonable.
 * Los emails inválidos (o nulos) DEBEN bloquear el envío del borrador dejándolo en
 * `borrador`, o impedir la creación del email manual (422 en la superficie HTTP).
 */
export const esEmailValido = (email: string | null | undefined): boolean => {
  if (email === null || email === undefined) {
    return false;
  }

  // No se normaliza (trim): un email con espacios al inicio/fin es inválido tal cual.
  if (email.length === 0 || email.trim().length === 0) {
    return false;
  }
  if (email.length > MAX_TOTAL) {
    return false;
  }

  const partes = email.split('@');
  if (partes.length !== 2) {
    return false;
  }

  const [local, dominio] = partes;
  if (local.length === 0 || local.length > MAX_LOCAL) {
    return false;
  }
  if (dominio.length === 0 || dominio.length > MAX_DOMINIO) {
    return false;
  }

  return PATRON_LOCAL.test(local) && PATRON_DOMINIO.test(dominio);
};
