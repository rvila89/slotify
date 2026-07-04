/**
 * Tokens de inyección (Symbol) de los puertos del módulo `facturacion` (US-022).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación dependen
 * solo de las interfaces (puertos); la infraestructura las implementa y se enlazan a estos
 * tokens en el módulo.
 */

/** Unidad de trabajo transaccional de facturación (tx + RLS). */
export const UNIDAD_DE_TRABAJO_FACTURACION_PORT = Symbol('UnidadDeTrabajoFacturacionPort');
/** Lectura de la RESERVA facturable. */
export const CARGAR_RESERVA_FACTURABLE_PORT = Symbol('CargarReservaFacturablePort');
/** Lectura de los datos fiscales del CLIENTE (receptor). */
export const CARGAR_CLIENTE_FISCAL_PORT = Symbol('CargarClienteFiscalPort');
/** Lectura de los datos fiscales del TENANT (emisor). */
export const CARGAR_TENANT_FISCAL_PORT = Symbol('CargarTenantFiscalPort');
/** Lectura de la FACTURA por id (aprobar/rechazar). */
export const CARGAR_FACTURA_PORT = Symbol('CargarFacturaPort');
/** Lectura de la FACTURA + reserva/cliente para regenerar el PDF. */
export const CARGAR_FACTURA_PARA_PDF_PORT = Symbol('CargarFacturaParaPdfPort');
/** Enumeración de campos fiscales faltantes del CLIENTE (guarda de aprobación). */
export const CAMPOS_FISCALES_FALTANTES_PORT = Symbol('CamposFiscalesFaltantesPort');
/** Generación del PDF de la factura. */
export const GENERAR_PDF_FACTURA_PORT = Symbol('GenerarPdfFacturaPort');
/** Aplicación de la aprobación (transición a enviada). */
export const APROBAR_FACTURA_PORT = Symbol('AprobarFacturaPort');
/** Registro de auditoría de aprobación/rechazo. */
export const AUDITORIA_APROBACION_PORT = Symbol('AuditoriaAprobacionPort');
/** Reloj del sistema. */
export const FACTURACION_CLOCK_PORT = Symbol('FacturacionClockPort');
