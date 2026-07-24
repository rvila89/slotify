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

// --- fix-liquidacion-fianza-independientes: emisión standalone de la liquidación (UC-21) ---
/** Unidad de trabajo transaccional de la emisión de la liquidación (tx + RLS). */
export const UNIDAD_DE_TRABAJO_EMISION_PORT = Symbol('UnidadDeTrabajoLiquidacionEmisionPort');
/** Lectura de la RESERVA para la emisión de la liquidación (email + idioma + fianzaEur). */
export const CARGAR_RESERVA_EMISION_PORT = Symbol('CargarReservaLiquidacionEmisionPort');
/** Envío SÍNCRONO/CONFIRMADO de E4 (solo liquidación). */
export const ENVIAR_E4_EMISION_PORT = Symbol('EnviarE4EmisionPort');
/** Lectura de la FACTURA de liquidación (GET /reservas/{id}/factura-liquidacion). */
export const CARGAR_FACTURA_LIQUIDACION_PORT = Symbol('CargarFacturaLiquidacionPort');
/** Verificación de si ya se envió E4 (COMUNICACION E4 `enviado`, no reenvío). */
export const VERIFICAR_E4_ENVIADO_PORT = Symbol('VerificarE4EnviadoPort');
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

// --- 6.4b / US-023: envío de la factura de señal (40%) + condicions particulars por E3 ---
/** Unidad de trabajo transaccional del envío de la señal (tx + RLS). */
export const UNIDAD_DE_TRABAJO_SENAL_EMISION_PORT = Symbol('UnidadDeTrabajoSenalEmisionPort');
/** Lectura de la RESERVA para el envío de la señal (email cliente + cond_part_*). */
export const CARGAR_RESERVA_SENAL_EMISION_PORT = Symbol('CargarReservaSenalEmisionPort');
/** Envío SÍNCRONO/CONFIRMADO de E3 (factura de señal + condicions particulars, puerto directo). */
export const ENVIAR_E3_EMISION_PORT = Symbol('EnviarE3EmisionPort');
/** Verificación de si ya se envió E3 (COMUNICACION E3 `enviado`, no reenvío) para la reserva. */
export const VERIFICAR_E3_ENVIADO_PORT = Symbol('VerificarE3EnviadoPort');

// --- US-023 (GAP 3): reenvío manual de E3 (factura de señal + condiciones) ---
/** Lectura de la RESERVA para el reenvío de E3 (email cliente + cond_part_enviadas_fecha). */
export const CARGAR_RESERVA_REENVIO_E3_PORT = Symbol('CargarReservaReenvioE3Port');
/** Lectura de la FACTURA de señal ya emitida (reenvío de E3). */
export const CARGAR_FACTURA_SENAL_REENVIO_PORT = Symbol('CargarFacturaSenalReenvioPort');
/** Lectura de la COMUNICACION E3 `enviado` previa (precondición del reenvío). */
export const BUSCAR_E3_PREVIA_PORT = Symbol('BuscarE3PreviaPort');
/** Lectura del DOCUMENTO de condiciones ya persistido (GAP 1), a reutilizar en el reenvío. */
export const BUSCAR_DOCUMENTO_CONDICIONES_PORT = Symbol('BuscarDocumentoCondicionesPort');
/** Reenvío de E3 (reutiliza los documentos ya persistidos). */
export const REENVIAR_E3_PORT = Symbol('ReenviarE3Port');
/** Registro de la NUEVA COMUNICACION E3 del reenvío (es_reenvio=true). */
export const REGISTRAR_COMUNICACION_REENVIO_E3_PORT = Symbol('RegistrarComunicacionReenvioE3Port');
/** Actualización de cond_part_enviadas_fecha al reenviar E3. */
export const FIJAR_CONDICIONES_ENVIADAS_REENVIO_PORT = Symbol('FijarCondicionesEnviadasReenvioPort');
/** Registro de auditoría del reenvío de E3. */
export const REGISTRAR_AUDITORIA_REENVIO_E3_PORT = Symbol('RegistrarAuditoriaReenvioE3Port');

// --- US-029: registro del cobro de la liquidación (UC-21 pasos 7-10, D-2) ---
/** Unidad de trabajo transaccional del cobro (tx + RLS + SELECT ... FOR UPDATE sobre RESERVA). */
export const UNIDAD_DE_TRABAJO_COBRO_PORT = Symbol('UnidadDeTrabajoCobroPort');

// --- fix-liquidacion-fianza-independientes: fianza pasiva (comprobante) + devolución completa ---
/** Unidad de trabajo transaccional de la subida del comprobante de la fianza (tx + RLS). */
export const UNIDAD_DE_TRABAJO_COMPROBANTE_FIANZA_PORT = Symbol(
  'UnidadDeTrabajoComprobanteFianzaPort',
);
/** Lectura de la RESERVA (estado + fianza_status) para la subida del comprobante. */
export const CARGAR_RESERVA_COMPROBANTE_FIANZA_PORT = Symbol(
  'CargarReservaComprobanteFianzaPort',
);
/** Almacenamiento físico del comprobante de la fianza (clave versionada). */
export const ALMACENAR_COMPROBANTE_FIANZA_PORT = Symbol('AlmacenarComprobanteFianzaPort');
/**
 * Unidad de trabajo transaccional de la DEVOLUCIÓN completa de la FIANZA (tx + RLS + SELECT ...
 * FOR UPDATE sobre RESERVA para serializar el doble registro).
 */
export const UNIDAD_DE_TRABAJO_DEVOLVER_FIANZA_PORT = Symbol('UnidadDeTrabajoDevolverFianzaPort');
/** Disparo de E10 (fianza devuelta) POST-COMMIT best-effort. */
export const DISPARAR_E10_PORT = Symbol('DispararE10Port');
