/**
 * Tokens de inyección (Symbol) de los puertos del bloqueo de fecha (US-040).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio depende
 * solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */
export const FECHA_BLOQUEADA_REPOSITORY_PORT = Symbol('FechaBloqueadaRepositoryPort');
export const TENANT_SETTINGS_PORT = Symbol('TenantSettingsPort');
export const CLOCK_PORT = Symbol('ClockPort');
