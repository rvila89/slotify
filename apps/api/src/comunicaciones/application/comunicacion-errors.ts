/**
 * Errores de aplicación COMPARTIDOS por los casos de uso de la acción manual de
 * comunicaciones (US-046 / UC-36): `EnviarBorradorUseCase`, `DescartarBorradorUseCase`
 * y `CrearEmailManualUseCase`.
 *
 * Viven en un ÚNICO módulo para que sean la MISMA clase en todos los use-cases: el
 * controller mapea por `instanceof` (409/422/502) y, si cada use-case definiera su
 * propia clase homónima, el `instanceof` fallaría para unos endpoints y el error caería
 * a un 500 genérico. (Regresión detectada en QA: el email `manual` con cliente sin email
 * devolvía 500 en vez de 422 porque su `DestinatarioInvalidoError` era una clase distinta
 * de la que comprobaba el controller.)
 *
 * Aplicación PURA: sin `@nestjs/*`, Prisma ni infraestructura.
 */

/** El destinatario (CLIENTE.email) es nulo/ inválido (RFC 5321): bloquea el envío → 422. */
export class DestinatarioInvalidoError extends Error {
  readonly codigo = 'destinatario_invalido';

  constructor() {
    super('El cliente no tiene un email válido registrado');
    this.name = 'DestinatarioInvalidoError';
  }
}

/** El proveedor de email falló al enviar (la fila quedó en `fallido`) → 502. */
export class ProveedorEmailError extends Error {
  readonly codigo = 'proveedor_email';

  constructor() {
    super('El proveedor de email falló al enviar; puedes reintentarlo');
    this.name = 'ProveedorEmailError';
  }
}
