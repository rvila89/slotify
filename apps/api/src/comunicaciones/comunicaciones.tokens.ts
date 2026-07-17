/**
 * Tokens de inyección (Symbol) de los puertos del módulo comunicaciones.
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */

/** Puerto de transporte de email (US-003; adaptador real Resend/Fake en US-045). */
export const ENVIAR_EMAIL_PORT = Symbol('EnviarEmailPort');

// US-045 — motor de email automático
/** Catálogo de plantillas por código + idioma. */
export const CATALOGO_PLANTILLAS_PORT = Symbol('CatalogoPlantillasPort');
/** Repositorio de la trazabilidad en COMUNICACION. */
export const COMUNICACION_REPOSITORY_PORT = Symbol('ComunicacionRepositoryPort');
/** Lectura del idioma del tenant (TENANT_SETTINGS.idioma). */
export const TENANT_SETTINGS_IDIOMA_PORT = Symbol('TenantSettingsIdiomaPort');
/** Reloj del motor (fecha_envio testeable). */
export const COMUNICACIONES_CLOCK_PORT = Symbol('ComunicacionesClockPort');

// US-046 — acción manual de comunicaciones de una reserva
/** Carga de la COMUNICACION para enviar/descartar (scoped por tenant, RLS). */
export const CARGAR_COMUNICACION_PORT = Symbol('CargarComunicacionPort');
/** Carga de la RESERVA + CLIENTE para el email manual (scoped por tenant, RLS). */
export const CARGAR_RESERVA_CONTEXTO_PORT = Symbol('CargarReservaContextoPort');
