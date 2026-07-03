/**
 * Tokens de inyección (Symbol) de los puertos del módulo presupuestos (US-014).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */

/** Unidad de trabajo transaccional de la activación de pre_reserva (UC-14). */
export const UNIDAD_DE_TRABAJO_ACTIVAR_PRERESERVA_PORT = Symbol(
  'UnidadDeTrabajoActivarPrereservaPort',
);
/** Lectura de la RESERVA (fuera de la tx crítica). */
export const CARGAR_RESERVA_PRESUPUESTO_PORT = Symbol('CargarReservaPresupuestoPort');
/** Lectura del CLIENTE (validación fiscal FA-01). */
export const CARGAR_CLIENTE_PRESUPUESTO_PORT = Symbol('CargarClientePresupuestoPort');
/** Lectura de los settings del tenant (TTL / reparto). */
export const TENANT_SETTINGS_PRESUPUESTO_PORT = Symbol('TenantSettingsPresupuestoPort');
/** Generación del PDF del presupuesto (post-commit). */
export const GENERAR_PDF_PRESUPUESTO_PORT = Symbol('GenerarPdfPresupuestoPort');
/** Disparo del E2 post-commit (motor de email US-045). */
export const DISPARAR_E2_PORT = Symbol('DispararE2Port');
/** Reloj del sistema (TTL de la pre_reserva). */
export const PRESUPUESTOS_CLOCK_PORT = Symbol('PresupuestosClockPort');
