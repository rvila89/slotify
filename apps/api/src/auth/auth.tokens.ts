/**
 * Tokens de inyección (Symbol) de los puertos y casos de uso de `auth` (US-001).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en `auth.module.ts`.
 */
export const USUARIO_REPOSITORY_PORT = Symbol('UsuarioRepositoryPort');
export const PASSWORD_HASHER_PORT = Symbol('PasswordHasherPort');
export const TOKEN_EMITTER_PORT = Symbol('TokenEmitterPort');
export const AUTH_AUDIT_LOG_PORT = Symbol('AuthAuditLogPort');

export const LOGIN_USE_CASE = Symbol('LoginUseCase');
export const REFRESH_USE_CASE = Symbol('RefreshUseCase');
export const LOGOUT_USE_CASE = Symbol('LogoutUseCase');
export const OBTENER_USUARIO_ACTUAL_USE_CASE = Symbol('ObtenerUsuarioActualUseCase');
