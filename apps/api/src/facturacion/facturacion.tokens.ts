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

// --- US-027: borradores de liquidación y fianza ---
/** Unidad de trabajo transaccional de los borradores (tx + RLS). */
export const UNIDAD_DE_TRABAJO_BORRADORES_PORT = Symbol('UnidadDeTrabajoBorradoresPort');
/** Lectura de la RESERVA liquidable (origen + importe de liquidación congelado). */
export const CARGAR_RESERVA_LIQUIDABLE_PORT = Symbol('CargarReservaLiquidablePort');
/** Lectura de los RESERVA_EXTRA pendientes (`factura_id IS NULL`). */
export const CARGAR_EXTRAS_PENDIENTES_PORT = Symbol('CargarExtrasPendientesPort');
/** Lectura del importe de fianza por defecto del tenant. */
export const CARGAR_FIANZA_DEFAULT_PORT = Symbol('CargarFianzaDefaultPort');
/** Lectura de la colección de FACTURA de una reserva (GET /reservas/{id}/facturas). */
export const LISTAR_FACTURAS_RESERVA_PORT = Symbol('ListarFacturasReservaPort');

// --- 6.3: datos del documento de factura para el render real del PDF (design.md §D3) ---
/**
 * Carga de los datos del documento de factura (config del tenant + numeroPresupuesto +
 * regimenIva del presupuesto aceptado + cliente) para el adaptador REAL de PDF.
 */
export const CARGAR_DATOS_DOCUMENTO_FACTURA_PORT = Symbol('CargarDatosDocumentoFacturaPort');

// --- US-028: emisión y envío de la liquidación / fianza (UC-21, UC-22, D-4) ---
/** Unidad de trabajo transaccional de la emisión de la liquidación (tx + RLS). */
export const UNIDAD_DE_TRABAJO_EMISION_PORT = Symbol('UnidadDeTrabajoEmisionPort');
/** Lectura de la RESERVA para la emisión de la liquidación (email cliente). */
export const CARGAR_RESERVA_EMISION_PORT = Symbol('CargarReservaEmisionPort');
/** Envío SÍNCRONO/CONFIRMADO de E4 (liquidación + fianza). */
export const ENVIAR_E4_EMISION_PORT = Symbol('EnviarE4EmisionPort');
/** Unidad de trabajo transaccional del envío separado del recibo de fianza (tx + RLS). */
export const UNIDAD_DE_TRABAJO_FIANZA_PORT = Symbol('UnidadDeTrabajoFianzaPort');
/** Lectura de la RESERVA para el envío separado del recibo de fianza. */
export const CARGAR_RESERVA_FIANZA_PORT = Symbol('CargarReservaFianzaPort');
/** Envío SÍNCRONO/CONFIRMADO del recibo de fianza (email `manual`). */
export const ENVIAR_RECIBO_FIANZA_PORT = Symbol('EnviarReciboFianzaPort');
/** Lectura de la RESERVA para el reenvío de la liquidación. */
export const CARGAR_RESERVA_REENVIO_PORT = Symbol('CargarReservaReenvioPort');
/** Lectura de la FACTURA de liquidación ya emitida (reenvío). */
export const CARGAR_LIQUIDACION_REENVIO_PORT = Symbol('CargarLiquidacionReenvioPort');
/** Reenvío de E4 (reutiliza el PDF ya emitido). */
export const REENVIAR_E4_PORT = Symbol('ReenviarE4Port');
/** Registro de la NUEVA COMUNICACION de reenvío (excepción auditada a la idempotencia). */
export const REGISTRAR_COMUNICACION_REENVIO_PORT = Symbol('RegistrarComunicacionReenvioPort');
/** Registro de auditoría del reenvío. */
export const REGISTRAR_AUDITORIA_REENVIO_PORT = Symbol('RegistrarAuditoriaReenvioPort');

// --- US-029: registro del cobro de la liquidación (UC-21 pasos 7-10, D-2) ---
/** Unidad de trabajo transaccional del cobro (tx + RLS + SELECT ... FOR UPDATE sobre RESERVA). */
export const UNIDAD_DE_TRABAJO_COBRO_PORT = Symbol('UnidadDeTrabajoCobroPort');

// --- US-030: registro del cobro de la fianza (UC-22 pasos 5-9, D-1/D-2) ---
/**
 * Unidad de trabajo transaccional del cobro de la FIANZA (tx + RLS + SELECT ... FOR UPDATE sobre
 * RESERVA para serializar el doble cobro; política "Negociable" para `fianza_status = pendiente`).
 */
export const UNIDAD_DE_TRABAJO_COBRO_FIANZA_PORT = Symbol('UnidadDeTrabajoCobroFianzaPort');

// --- US-036: registro de la devolución de la fianza (UC-27 pasos 4-8, D-1/D-4) ---
/**
 * Unidad de trabajo transaccional de la DEVOLUCIÓN de la FIANZA (tx + RLS + SELECT ... FOR UPDATE
 * sobre RESERVA para serializar el doble registro; simétrico inverso del cobro de US-030).
 */
export const UNIDAD_DE_TRABAJO_DEVOLUCION_FIANZA_PORT = Symbol('UnidadDeTrabajoDevolucionFianzaPort');
