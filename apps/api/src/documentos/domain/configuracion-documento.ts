/**
 * VO de dominio de la configuración de documento por tenant (épico #6, rebanada
 * 6.1a `documentos-config-tenant-storage`).
 *
 * Es la FUENTE DE VERDAD del contenido de los documentos del tenant (decisión
 * A1: duplica sus propios datos fiscales; NO referencia `Tenant.nombre/nif/
 * direccion`). Agrupa el contenido configurable en cuatro bloques. Tipo puro de
 * dominio, sin imports de framework/infra (hook `no-infra-in-domain`).
 *
 * Matiz central del épico: `razonSocialFiscal` ("Canoliart, SL") y
 * `nombreComercial` ("Masia l'Encís") son campos DISTINTOS.
 */

/** Branding del documento (colores e imagen de marca). */
export interface BrandingDocumento {
  /** Clave/URL del logo en el object storage; `null` mientras no se sube (6.5). */
  logoUrl: string | null;
  /** Color primario en hexadecimal, p. ej. "#RRGGBB". */
  colorPrimario: string;
  /** Color de texto en hexadecimal. */
  colorTexto: string;
}

/** Identidad fiscal del emisor del documento. Razón social ≠ nombre comercial. */
export interface IdentidadFiscalDocumento {
  /** Razón social fiscal, p. ej. "Canoliart, SL". Distinta del nombre comercial. */
  razonSocialFiscal: string;
  /** Nombre comercial/marca, p. ej. "Masia l'Encís". */
  nombreComercial: string;
  nif: string;
  /** Dirección fiscal (puede ser multi-línea con `\n`). */
  direccionFiscal: string;
  web: string;
  email: string;
}

/** Datos bancarios para la transferencia. */
export interface BancaDocumento {
  iban: string;
  beneficiarioTransferencia: string;
  conceptoTransferencia: string;
}

/** Textos configurables del documento. */
export interface TextosDocumento {
  /**
   * Plantilla del concepto fiscal con placeholder `{nombreComercial}`. Regla
   * dura del épico: expresa "espai" y NUNCA contiene "lloguer".
   */
  plantillaConceptoFiscal: string;
  /** Texto de validez del documento, p. ej. "10 DIES". */
  validesaTexto: string;
  pieLegal: string;
}

/** Configuración de documento completa de un tenant (1-1 con `Tenant`). */
export interface ConfiguracionDocumentoTenant {
  tenantId: string;
  branding: BrandingDocumento;
  identidadFiscal: IdentidadFiscalDocumento;
  banca: BancaDocumento;
  textos: TextosDocumento;
}
