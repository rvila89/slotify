/**
 * MODELO DE VISTA del documento de presupuesto (épico #6, rebanada 6.1b
 * `documentos-presupuesto-pdf-con-iva`) — capa de presentación de `documentos`.
 *
 * Función PURA `construirModeloDocumentoPresupuesto(config, datos)` que resuelve todos
 * los textos/valores del documento a partir de la CONFIG del tenant (6.1a) + los DATOS
 * del presupuesto: concepto con `{nombreComercial}` sustituido (NUNCA "lloguer"),
 * "(N hores)" desde `duracionHoras`, flag de cabecera solo-texto (N3), base/%IVA/total,
 * IBAN, validesa, extras como sub-conceptos y reparto 40/60/fianza. Es la frontera que
 * reutilizará la factura (6.3): otro builder de "datos del documento" alimentando el
 * mismo layout.
 *
 * Hexagonal: `documentos` NO importa de `presupuestos`; los tipos de desglose/reparto
 * necesarios se declaran aquí (duplicados intencionadamente). Solo importa su propio VO
 * de dominio `ConfiguracionDocumentoTenant`.
 */
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';

/** Datos del CLIENTE (receptor) tal como se pintan en el documento. */
export interface ClienteDocumento {
  nombre: string;
  apellidos: string | null;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
}

/** Un extra como sub-concepto con su importe (Decimal string de 2 decimales). */
export interface ExtraDocumento {
  descripcion: string;
  importeEur: string;
}

/** Desglose fiscal del presupuesto (importes Decimal string de 2 decimales). */
export interface DesgloseDocumento {
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** Reparto informativo 40% señal / 60% liquidación + fianza aparte. */
export interface RepartoDocumento {
  senalEur: string;
  liquidacionEur: string;
  fianzaEur: string;
}

/** DATOS del presupuesto que alimentan el documento (ya resueltos, sin lógica de negocio). */
export interface DatosDocumentoPresupuesto {
  numeroPresupuesto: string;
  fecha: Date;
  cliente: ClienteDocumento;
  fechaEvento: Date;
  /** Duración del evento en horas (enum de negocio 4/8/12). */
  duracionHoras: number;
  numPersonas: number;
  extras: ReadonlyArray<ExtraDocumento>;
  desglose: DesgloseDocumento;
  reparto: RepartoDocumento;
}

/** Cabecera del documento: identidad fiscal del emisor + branding (logo/solo-texto). */
export interface CabeceraModelo {
  /** N3: `true` cuando no hay logo del tenant (cabecera solo-texto). */
  soloTexto: boolean;
  logoUrl: string | null;
  colorPrimario: string;
  colorTexto: string;
  razonSocialFiscal: string;
  nombreComercial: string;
  nif: string;
  direccionFiscal: string;
  web: string;
  email: string;
}

/** Pie bancario del documento (datos de la transferencia del tenant). */
export interface PieBancarioModelo {
  iban: string;
  beneficiario: string;
  concepto: string;
}

/** MODELO DE VISTA completo del documento de presupuesto (todo resuelto). */
export interface ModeloDocumentoPresupuesto {
  numeroPresupuesto: string;
  fecha: Date;
  cabecera: CabeceraModelo;
  cliente: ClienteDocumento;
  fechaEvento: Date;
  /** Texto de duración "(N hores)" (N5: solo horas, sin rango horario). */
  duracionTexto: string;
  numPersonas: number;
  /** Concepto fiscal con `{nombreComercial}` resuelto; NUNCA contiene "lloguer". */
  conceptoPrincipal: string;
  extras: ReadonlyArray<ExtraDocumento>;
  totales: DesgloseDocumento;
  reparto: RepartoDocumento;
  validesaTexto: string;
  pieLegal: string;
  pieBancario: PieBancarioModelo;
}

/** Sustituye el placeholder `{nombreComercial}` por el valor real del tenant. */
const resolverConcepto = (
  plantilla: string,
  nombreComercial: string,
): string => plantilla.replaceAll('{nombreComercial}', nombreComercial);

/**
 * Construye el modelo de vista del documento a partir de la config del tenant + los datos
 * del presupuesto. PURA y determinista: todas las aserciones de CONTENIDO recaen aquí.
 */
export const construirModeloDocumentoPresupuesto = (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuesto,
): ModeloDocumentoPresupuesto => ({
  numeroPresupuesto: datos.numeroPresupuesto,
  fecha: datos.fecha,
  cabecera: {
    soloTexto: config.branding.logoUrl === null,
    logoUrl: config.branding.logoUrl,
    colorPrimario: config.branding.colorPrimario,
    colorTexto: config.branding.colorTexto,
    razonSocialFiscal: config.identidadFiscal.razonSocialFiscal,
    nombreComercial: config.identidadFiscal.nombreComercial,
    nif: config.identidadFiscal.nif,
    direccionFiscal: config.identidadFiscal.direccionFiscal,
    web: config.identidadFiscal.web,
    email: config.identidadFiscal.email,
  },
  cliente: datos.cliente,
  fechaEvento: datos.fechaEvento,
  duracionTexto: `(${datos.duracionHoras} hores)`,
  numPersonas: datos.numPersonas,
  conceptoPrincipal: resolverConcepto(
    config.textos.plantillaConceptoFiscal,
    config.identidadFiscal.nombreComercial,
  ),
  extras: datos.extras.map((extra) => ({
    descripcion: extra.descripcion,
    importeEur: extra.importeEur,
  })),
  totales: {
    baseImponible: datos.desglose.baseImponible,
    ivaPorcentaje: datos.desglose.ivaPorcentaje,
    ivaImporte: datos.desglose.ivaImporte,
    total: datos.desglose.total,
  },
  reparto: datos.reparto,
  validesaTexto: config.textos.validesaTexto,
  pieLegal: config.textos.pieLegal,
  pieBancario: {
    iban: config.banca.iban,
    beneficiario: config.banca.beneficiarioTransferencia,
    concepto: config.banca.conceptoTransferencia,
  },
});
