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

// US-005 — transición «añadir fecha» (2.a → 2.b/2.d)
export const UNIDAD_DE_TRABAJO_TRANSICION_PORT = Symbol(
  'UnidadDeTrabajoTransicionPort',
);
export const CONFIRMACION_BLOQUEO_EMAIL_PORT = Symbol(
  'ConfirmacionBloqueoEmailPort',
);

// US-005 — lectura de la ficha (GET /reservas/{id} → ReservaDetalle)
export const RESERVA_DETALLE_QUERY_PORT = Symbol('ReservaDetalleQueryPort');

// US-007 — transición «pendiente de invitados» (2.b → 2.c)
export const UNIDAD_DE_TRABAJO_PENDIENTE_INVITADOS_PORT = Symbol(
  'UnidadDeTrabajoPendienteInvitadosPort',
);

// US-008 — transición «programar visita» (2.a/2.b/2.c → 2.v)
export const UNIDAD_DE_TRABAJO_PROGRAMAR_VISITA_PORT = Symbol(
  'UnidadDeTrabajoProgramarVisitaPort',
);
export const CONFIRMACION_VISITA_EMAIL_PORT = Symbol(
  'ConfirmacionVisitaEmailPort',
);

// US-006 — extensión manual del TTL del bloqueo blando
export const UNIDAD_DE_TRABAJO_EXTENDER_BLOQUEO_PORT = Symbol(
  'UnidadDeTrabajoExtenderBloqueoPort',
);

// US-012 — barrido de expiración por TTL (cross-tenant read + UoW por RESERVA)
export const CANDIDATAS_EXPIRACION_PORT = Symbol('CandidatasExpiracionPort');
export const EXPIRACION_RESERVA_PORT = Symbol('ExpiracionReservaPort');

// US-018 — promoción automática del primero en cola (UoW atómica de promoción)
export const PROMOCION_COLA_UOW_PORT = Symbol('PromocionColaUoWPort');

// US-017 — lectura de la cola de espera (GET /reservas/{id}/cola → ColaEsperaResponse)
export const COLA_ESPERA_QUERY_PORT = Symbol('ColaEsperaQueryPort');
