/**
 * Tokens de inyección (Symbol) de los puertos del registro de la firma de condiciones
 * particulares (US-024, capability `confirmacion`).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio/aplicación
 * dependen solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */

/** Unidad de trabajo transaccional del registro de la firma (crear DOCUMENTO + marcar RESERVA + AUDIT_LOG). */
export const UNIDAD_DE_TRABAJO_FIRMA_CONDICIONES_PORT = Symbol(
  'UnidadDeTrabajoFirmaCondicionesPort',
);
/** Lectura de la RESERVA (fuera de la tx crítica) para las guardas de precondición. */
export const CARGAR_RESERVA_FIRMA_CONDICIONES_PORT = Symbol(
  'CargarReservaFirmaCondicionesPort',
);
/** Almacenamiento físico de la copia firmada (clave versionada por reserva). */
export const ALMACENAR_CONDICIONES_FIRMADAS_PORT = Symbol(
  'AlmacenarCondicionesFirmadasPort',
);
/** Reloj del sistema para la fecha de firma. */
export const FIRMA_CONDICIONES_CLOCK_PORT = Symbol('FirmaCondicionesClockPort');
/** Lectura del detalle de la RESERVA para la respuesta 200 (read-DTO). */
export const RESERVA_DETALLE_FIRMA_CONDICIONES_PORT = Symbol(
  'ReservaDetalleFirmaCondicionesPort',
);
