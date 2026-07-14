/**
 * Tokens de inyección (Symbol) de los puertos del módulo documentos.
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio depende
 * solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */
export const ALMACEN_DOCUMENTOS_PORT = Symbol('AlmacenDocumentosPort');
export const CONFIGURACION_DOCUMENTO_REPOSITORY_PORT = Symbol(
  'ConfiguracionDocumentoRepositoryPort',
);
/** Épico #6, rebanada 6.4a: puerto de generación del PDF de "Condicions particulars". */
export const GENERAR_PDF_CONDICIONES_PORT = Symbol('GenerarPdfCondicionesPort');
