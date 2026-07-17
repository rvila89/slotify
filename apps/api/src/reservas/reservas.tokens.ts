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

// US-009 — registro del resultado de visita «cliente interesado» (2.v → 2.b)
export const UNIDAD_DE_TRABAJO_RESULTADO_VISITA_PORT = Symbol(
  'UnidadDeTrabajoResultadoVisitaPort',
);
export const CONFIRMACION_RESULTADO_VISITA_EMAIL_PORT = Symbol(
  'ConfirmacionResultadoVisitaEmailPort',
);

// US-010 — carga del CLIENTE para la validación de datos obligatorios UC-14 (reserva
// inmediata, 2.v → pre_reserva)
export const CARGAR_CLIENTE_RESULTADO_VISITA_PORT = Symbol(
  'CargarClienteResultadoVisitaPort',
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

// US-019 — promoción manual de una consulta arbitraria de la cola por el Gestor
export const PROMOCION_MANUAL_COLA_UOW_PORT = Symbol('PromocionManualColaUoWPort');

// US-017 — lectura de la cola de espera (GET /reservas/{id}/cola → ColaEsperaResponse)
export const COLA_ESPERA_QUERY_PORT = Symbol('ColaEsperaQueryPort');

// US-049 — pipeline de reservas activas (GET /reservas → ReservaListResponse)
export const PIPELINE_QUERY_PORT = Symbol('PipelineQueryPort');

// US-042 — histórico de reservas cerradas (GET /historico → ReservaHistoricoListResponse)
export const HISTORICO_QUERY_PORT = Symbol('HistoricoQueryPort');

// US-031 — barrido de inicio automático de evento en T-0 (cross-tenant read + UoW por RESERVA)
export const CANDIDATAS_INICIO_EVENTO_PORT = Symbol('CandidatasInicioEventoPort');
export const INICIO_EVENTO_PORT = Symbol('InicioEventoPort');
export const ALERTA_INICIO_EVENTO_PORT = Symbol('AlertaInicioEventoPort');

// US-034 — finalización manual del evento (evento_en_curso → post_evento + E5 condicionado)
export const CARGAR_RESERVA_FINALIZACION_PORT = Symbol('CargarReservaFinalizacionPort');
export const UNIDAD_DE_TRABAJO_FINALIZACION_PORT = Symbol(
  'UnidadDeTrabajoFinalizacionPort',
);
export const DISPARAR_E5_PORT = Symbol('DispararE5Port');
export const DOCUMENTACION_EVENTO_PORT = Symbol('DocumentacionEventoPort');

// US-032 — forzado manual del inicio de evento (reserva_confirmada → evento_en_curso, acción del
// Gestor con JWT; carga bajo RLS + UoW atómica con SELECT … FOR UPDATE + UPDATE condicional +
// AUDIT_LOG origen Usuario con forzado_por_gestor + precondiciones_incumplidas)
export const CARGAR_RESERVA_FORZAR_INICIO_PORT = Symbol('CargarReservaForzarInicioPort');
export const UNIDAD_DE_TRABAJO_FORZAR_INICIO_PORT = Symbol(
  'UnidadDeTrabajoForzarInicioPort',
);

// US-035 — registro del IBAN de devolución (post_evento + fianza > 0 → CLIENTE.iban_devolucion + E8)
export const CARGAR_RESERVA_IBAN_DEVOLUCION_PORT = Symbol(
  'CargarReservaIbanDevolucionPort',
);
export const UNIDAD_DE_TRABAJO_IBAN_DEVOLUCION_PORT = Symbol(
  'UnidadDeTrabajoIbanDevolucionPort',
);
export const DISPARAR_E8_PORT = Symbol('DispararE8Port');

// US-014 #5 (Parte B) — actualización de datos fiscales del CLIENTE de una RESERVA (UPDATE parcial
// de columnas escalares del CLIENTE + AUDIT_LOG, bajo RLS del tenant del JWT)
export const CARGAR_RESERVA_DATOS_FISCALES_PORT = Symbol(
  'CargarReservaDatosFiscalesPort',
);
export const UNIDAD_DE_TRABAJO_DATOS_FISCALES_PORT = Symbol(
  'UnidadDeTrabajoDatosFiscalesPort',
);

// US-037 — barrido de archivado automático en T+7d (cross-tenant read + UoW por RESERVA +
// alerta interna FA-01 en AUDIT_LOG con anti-duplicación)
export const CANDIDATAS_ARCHIVADO_PORT = Symbol('CandidatasArchivadoPort');
export const ARCHIVADO_PORT = Symbol('ArchivadoPort');
export const ALERTA_FIANZA_PENDIENTE_PORT = Symbol('AlertaFianzaPendientePort');

// US-038 — archivado MANUAL de la reserva por el Gestor (post_evento → reserva_completada,
// acción de usuario con JWT; UoW propia delgada + carga bajo RLS del tenant del JWT)
export const CARGAR_RESERVA_ARCHIVADO_MANUAL_PORT = Symbol(
  'CargarReservaArchivadoManualPort',
);
export const UNIDAD_DE_TRABAJO_ARCHIVADO_MANUAL_PORT = Symbol(
  'UnidadDeTrabajoArchivadoManualPort',
);

// US-013 — descarte por cliente ({2a,2b,2c,2d,2v} → 2z, acción manual del Gestor con JWT; UoW
// atómica propia con SELECT … FOR UPDATE + liberarFecha()/promoción/decremento de cola según origen)
export const UNIDAD_DE_TRABAJO_DESCARTE_CONSULTA_PORT = Symbol(
  'UnidadDeTrabajoDescarteConsultaPort',
);
