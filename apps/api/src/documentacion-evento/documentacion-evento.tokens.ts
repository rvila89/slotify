/**
 * Tokens de inyección (Symbol) de los puertos del módulo `documentacion-evento` (US-033).
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio depende solo de las
 * interfaces (puertos); la infraestructura las implementa y se enlazan a estos tokens.
 */
export const UNIDAD_DE_TRABAJO_DOCUMENTACION_EVENTO_PORT = Symbol(
  'UnidadDeTrabajoDocumentacionEventoPort',
);
export const CARGAR_RESERVA_DOCUMENTACION_EVENTO_PORT = Symbol(
  'CargarReservaDocumentacionEventoPort',
);
export const ALMACENAR_DOCUMENTO_EVENTO_PORT = Symbol('AlmacenarDocumentoEventoPort');
export const LISTAR_DOCUMENTOS_EVENTO_PORT = Symbol('ListarDocumentosEventoPort');
