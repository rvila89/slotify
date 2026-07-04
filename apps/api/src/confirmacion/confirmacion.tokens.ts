/**
 * Tokens de inyección (Symbol) de los puertos del módulo confirmacion (US-021).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */

/** Unidad de trabajo transaccional de la confirmación de señal (UC-17). */
export const UNIDAD_DE_TRABAJO_CONFIRMACION_PORT = Symbol(
  'UnidadDeTrabajoConfirmacionPort',
);
/** Lectura de la RESERVA (fuera de la tx crítica). */
export const CARGAR_RESERVA_CONFIRMACION_PORT = Symbol('CargarReservaConfirmacionPort');
/** Lectura de los settings del tenant (pct_senal). */
export const TENANT_SETTINGS_CONFIRMACION_PORT = Symbol('TenantSettingsConfirmacionPort');
/** Almacenamiento físico del fichero justificante. */
export const ALMACENAR_JUSTIFICANTE_PORT = Symbol('AlmacenarJustificantePort');
/** Presentación de la factura de señal en borrador (post-commit, US-022). */
export const PRESENTAR_FACTURA_SENAL_BORRADOR_PORT = Symbol(
  'PresentarFacturaSenalBorradorPort',
);
/** Generación de los borradores de liquidación y fianza (post-commit, US-027). */
export const GENERAR_BORRADORES_LIQUIDACION_FIANZA_PORT = Symbol(
  'GenerarBorradoresLiquidacionFianzaPort',
);
/** Reloj del sistema. */
export const CONFIRMACION_CLOCK_PORT = Symbol('ConfirmacionClockPort');
