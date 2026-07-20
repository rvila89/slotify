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

/**
 * Texto bilingüe es/ca (change `pdf-presupuesto-horario-idioma`, Mejora 3). El documento
 * de presupuesto elige el idioma según `Reserva.idioma`; los textos libres del tenant se
 * gestionan por seed/migración (no hay UI de edición).
 */
export interface TextoBilingue {
  ca: string;
  es: string;
}

/** Textos configurables del documento (bilingües es/ca, Mejora 3). */
export interface TextosDocumento {
  /**
   * Plantilla del concepto fiscal con placeholder `{nombreComercial}`. Regla
   * dura del épico: expresa "espai" y NUNCA contiene "lloguer".
   */
  plantillaConceptoFiscal: TextoBilingue;
  /** Texto de validez del documento, p. ej. "10 DIES"/"10 DÍAS". */
  validesaTexto: TextoBilingue;
  pieLegal: TextoBilingue;
}

/**
 * Una sección de las "Condicions particulars" (épico #6, rebanada 6.4a): par
 * título + cuerpo, bilingüe es/ca (Mejora 3). El cuerpo puede ser multi-línea (con `\n`).
 */
export interface SeccionCondiciones {
  titulo: TextoBilingue;
  cuerpo: TextoBilingue;
}

/**
 * Bloque de "Condicions particulars" del documento (épico #6, rebanada 6.4a):
 * título del documento + lista ordenada de secciones (bilingües es/ca, Mejora 3). El
 * tipo tolera 0 secciones; la degradación a `null` (no adjuntar) cuando no hay secciones
 * la decide el adaptador real (D3), no el tipo.
 */
export interface CondicionesDocumento {
  titulo: TextoBilingue;
  secciones: SeccionCondiciones[];
}

/** Configuración de documento completa de un tenant (1-1 con `Tenant`). */
export interface ConfiguracionDocumentoTenant {
  tenantId: string;
  branding: BrandingDocumento;
  identidadFiscal: IdentidadFiscalDocumento;
  banca: BancaDocumento;
  textos: TextosDocumento;
  /** Condicions particulars (épico #6, rebanada 6.4a): título + secciones. */
  condiciones: CondicionesDocumento;
}
