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
/** Lectura de los datos del documento de presupuesto (para el PDF real, épico #6 6.1b). */
export const CARGAR_DATOS_DOCUMENTO_PRESUPUESTO_PORT = Symbol(
  'CargarDatosDocumentoPresupuestoPort',
);
/** Disparo del E2 post-commit (motor de email US-045). */
export const DISPARAR_E2_PORT = Symbol('DispararE2Port');
/** Persistencia best-effort de `pdf_url` en la fila del PRESUPUESTO (post-commit). */
export const GUARDAR_PDF_URL_PRESUPUESTO_PORT = Symbol(
  'GuardarPdfUrlPresupuestoPort',
);
/** Reloj del sistema (TTL de la pre_reserva). */
export const PRESUPUESTOS_CLOCK_PORT = Symbol('PresupuestosClockPort');

// ---------------------------------------------------------------------------
// US-015 — Edición / reenvío del presupuesto en pre_reserva
// ---------------------------------------------------------------------------

/** Unidad de trabajo transaccional de la edición (versionado + líneas + auditoría). */
export const UNIDAD_DE_TRABAJO_EDITAR_PRESUPUESTO_PORT = Symbol(
  'UnidadDeTrabajoEditarPresupuestoPort',
);
/** Lectura de la RESERVA para la edición (guardas). */
export const CARGAR_RESERVA_EDICION_PORT = Symbol('CargarReservaEdicionPort');
/** Lectura del PRESUPUESTO vigente (`MAX(version)`). */
export const CARGAR_PRESUPUESTO_VIGENTE_PORT = Symbol('CargarPresupuestoVigentePort');
/** Lectura del precio ACTUAL de un EXTRA del catálogo (congelar líneas nuevas). */
export const CARGAR_EXTRA_CATALOGO_PORT = Symbol('CargarExtraCatalogoPort');
/** Lectura del conjunto vivo de líneas `RESERVA_EXTRA` de la RESERVA. */
export const CARGAR_LINEAS_EXISTENTES_PORT = Symbol('CargarLineasExistentesPort');
/** Reenvío del E2 del reenvío sin cambios (best-effort). */
export const REENVIAR_E2_PRESUPUESTO_PORT = Symbol('ReenviarE2PresupuestoPort');
/** Registro de la COMUNICACION E2 del reenvío (`es_reenvio=true`). */
export const REGISTRAR_E2_REENVIO_PORT = Symbol('RegistrarE2ReenvioPort');
/** Registro del AUDIT_LOG del reenvío (`accion='actualizar'`). */
export const REGISTRAR_AUDITORIA_REENVIO_PORT = Symbol('RegistrarAuditoriaReenvioPort');
