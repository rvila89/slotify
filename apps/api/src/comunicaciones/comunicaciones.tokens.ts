/**
 * Tokens de inyección (Symbol) de los puertos del módulo comunicaciones.
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */
export const ENVIAR_EMAIL_PORT = Symbol('EnviarEmailPort');
