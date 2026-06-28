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

// US-041 — liberación de fecha
export const FECHA_BLOQUEADA_LIBERACION_PORT = Symbol('FechaBloqueadaLiberacionPort');
export const RESERVA_ESTADO_PORT = Symbol('ReservaEstadoPort');
export const COLA_QUERY_PORT = Symbol('ColaQueryPort');
export const PROMOCION_COLA_PORT = Symbol('PromocionColaPort');
export const AUDIT_LOG_PORT = Symbol('AuditLogPort');

// US-003 — alta de consulta exploratoria
export const UNIDAD_DE_TRABAJO_PORT = Symbol('UnidadDeTrabajoPort');

// US-004 — alta de consulta con fecha (tarifa estimada de E1)
export const TARIFA_ESTIMADA_PORT = Symbol('TarifaEstimadaPort');
