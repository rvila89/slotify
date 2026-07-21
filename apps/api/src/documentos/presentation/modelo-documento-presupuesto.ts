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
import type { IdiomaDocumento } from './meses';
import { formatearFechaLarga } from './meses';
import { formatearHorario } from './horario';
import { etiquetasDocumento, type EtiquetasDocumento } from './etiquetas-por-idioma';

/**
 * Régimen fiscal del documento (6.2). DECLARADO en `documentos` (NO se importa de
 * `presupuestos`; hexagonal): el régimen llega como dato del documento. Duplicado
 * intencionadamente, igual que los tipos de desglose/reparto.
 */
export type RegimenDocumento = 'con_iva' | 'sin_iva';

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
  /** Régimen fiscal del documento (6.2): gobierna cabecera y totales de la variante. */
  regimen: RegimenDocumento;
  /**
   * Idioma del documento (Mejora 3): `es`|`ca` según `Reserva.idioma`. Gobierna etiquetas
   * fijas, nombres de mes y la elección de los textos libres bilingües.
   */
  idioma: IdiomaDocumento;
  cliente: ClienteDocumento;
  fechaEvento: Date;
  /** Hora de inicio del evento "HH:MM" (Mejora 1); `null` cuando no está informada. */
  horario: string | null;
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
  /**
   * 6.2: `true` CON IVA, `false` SIN IVA. Cuando es `false`, la Cabecera OMITE la razón
   * social fiscal + el NIF (mantiene nombre comercial, dirección, web, email y branding).
   */
  mostrarIdentidadFiscal: boolean;
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

/** Totales del documento: desglose fiscal + flag de visibilidad del desglose de IVA (6.2). */
export interface TotalesModelo {
  /**
   * 6.2: `true` CON IVA, `false` SIN IVA. Cuando es `false`, BloqueTotales pinta SOLO el
   * Total (sin filas "Base imposable" e "IVA"). En SIN IVA `total = base` (importe MENOR).
   */
  mostrarDesgloseIva: boolean;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** Pie bancario del documento (datos de la transferencia del tenant). */
export interface PieBancarioModelo {
  /**
   * Fix "SIN IVA omite pie bancario": `true` CON IVA, `false` SIN IVA. Cuando es `false`,
   * `DocumentoLayout` NO compone `<PieBancario>` (solo el bloque de datos bancarios —
   * IBAN/beneficiario/concepto— se omite; el `pieLegal` es un elemento PROPIO del layout y
   * se pinta SIEMPRE, desacoplado de este bloque). Los demás campos (iban/beneficiario/
   * concepto) se siguen poblando igual desde la config.
   */
  mostrar: boolean;
  iban: string;
  beneficiario: string;
  concepto: string;
}

/** MODELO DE VISTA completo del documento de presupuesto (todo resuelto). */
export interface ModeloDocumentoPresupuesto {
  numeroPresupuesto: string;
  fecha: Date;
  /** Etiquetas fijas ya traducidas por idioma (Mejora 3). */
  etiquetas: EtiquetasDocumento;
  cabecera: CabeceraModelo;
  cliente: ClienteDocumento;
  fechaEvento: Date;
  /** Fecha del evento "D de <mes> de AAAA" en el idioma del cliente (Mejora 1). */
  fechaEventoTexto: string;
  /** Horario "De HH:MM a HH:MM (N <hores|horas>)" o fallback "(N ...)" (Mejora 1). */
  horarioTexto: string;
  /** Texto de duración "(N hores)" (N5: solo horas, sin rango horario). */
  duracionTexto: string;
  numPersonas: number;
  /** Concepto fiscal con `{nombreComercial}` resuelto; NUNCA contiene "lloguer". */
  conceptoPrincipal: string;
  extras: ReadonlyArray<ExtraDocumento>;
  totales: TotalesModelo;
  reparto: RepartoDocumento;
  validesaTexto: string;
  pieLegal: string;
  pieBancario: PieBancarioModelo;
}

/**
 * Sustituye el placeholder `{nombreComercial}` por el valor real del tenant.
 * Reutilizado por el modelo de vista de la factura (`modelo-documento-factura.ts`)
 * para resolver el concepto principal desde `plantillaConceptoFiscal` (change
 * `factura-pdf-fiel-referencia`, §D1): un único helper de interpolación, sin duplicar.
 */
export const interpolarNombreComercial = (
  plantilla: string,
  nombreComercial: string,
): string => plantilla.replaceAll('{nombreComercial}', nombreComercial);

/** Normaliza el idioma del documento al union `es|ca`; desconocido → `es` (default). */
const normalizarIdioma = (idioma: IdiomaDocumento): IdiomaDocumento =>
  idioma === 'ca' ? 'ca' : 'es';

/**
 * Construye el modelo de vista del documento a partir de la config del tenant + los datos
 * del presupuesto. PURA y determinista: todas las aserciones de CONTENIDO recaen aquí.
 */
export const construirModeloDocumentoPresupuesto = (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuesto,
): ModeloDocumentoPresupuesto => {
  // 6.2: la variante (flags de cabecera y totales) se resuelve desde el régimen del dato.
  const mostrarIdentidadFiscal = datos.regimen === 'con_iva';
  const mostrarDesgloseIva = datos.regimen === 'con_iva';
  const mostrarPieBancario = datos.regimen === 'con_iva';
  // Mejora 3: idioma normalizado gobierna etiquetas fijas, meses y textos libres.
  const idioma = normalizarIdioma(datos.idioma);
  return {
    numeroPresupuesto: datos.numeroPresupuesto,
    fecha: datos.fecha,
    etiquetas: etiquetasDocumento(idioma),
    cabecera: {
      soloTexto: config.branding.logoUrl === null,
      mostrarIdentidadFiscal,
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
    fechaEventoTexto: formatearFechaLarga(datos.fechaEvento, idioma),
    horarioTexto: formatearHorario(datos.horario, datos.duracionHoras, idioma),
    duracionTexto: `(${datos.duracionHoras} hores)`,
    numPersonas: datos.numPersonas,
    conceptoPrincipal: interpolarNombreComercial(
      config.textos.plantillaConceptoFiscal[idioma],
      config.identidadFiscal.nombreComercial,
    ),
    extras: datos.extras.map((extra) => ({
      descripcion: extra.descripcion,
      importeEur: extra.importeEur,
    })),
    totales: {
      mostrarDesgloseIva,
      baseImponible: datos.desglose.baseImponible,
      ivaPorcentaje: datos.desglose.ivaPorcentaje,
      ivaImporte: datos.desglose.ivaImporte,
      total: datos.desglose.total,
    },
    reparto: datos.reparto,
    validesaTexto: config.textos.validesaTexto[idioma],
    pieLegal: config.textos.pieLegal[idioma],
    pieBancario: {
      mostrar: mostrarPieBancario,
      iban: config.banca.iban,
      beneficiario: config.banca.beneficiarioTransferencia,
      concepto: config.banca.conceptoTransferencia,
    },
  };
};
