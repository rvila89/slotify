/**
 * MODELO DE VISTA del documento de FACTURA (épico #6, rebanada 6.3
 * `documentos-facturas-pdf`) — capa de presentación de `documentos`.
 *
 * Función PURA `construirModeloDocumentoFactura({ config, datos })` que resuelve todos los
 * textos/valores de la factura a partir de la CONFIG del tenant (6.1a) + los DATOS de la
 * factura (tipo, desglose fiscal congelado, número, fecha de emisión, extras y número de
 * presupuesto de referencia). Reutiliza la MISMA lógica de flags CON/SIN IVA que
 * `construirModeloDocumentoPresupuesto` de 6.2, pero derivada del `ivaPorcentaje` del
 * desglose (0 → SIN IVA): otro builder de "datos del documento" alimentando el mismo layout.
 *
 * §D1 (change `factura-pdf-fiel-referencia`): la señal/liquidación resuelven DOS campos de
 * concepto:
 *   - `concepto` (principal, negrita): desde `config.textos.plantillaConceptoFiscal.{idioma}`
 *     interpolando `{nombreComercial}` (mismo helper que el presupuesto; NUNCA "lloguer").
 *   - `conceptoSubtitulo` (indentado, no negrita): el 40/60 con prefijo asterisco:
 *       señal      → "*40% de l'import total anticipat del pressupost núm. {n}"
 *       liquidación→ "*60% de l'import restant del pressupost núm. {n}"
 * La FIANZA no cambia: su `concepto` sigue siendo "Fiança de garantia — {nombreComercial}"
 * (SIN nº de presupuesto: la fianza es del espacio) y su `conceptoSubtitulo` es `null`.
 * Cuando `numeroPresupuesto` es null en señal/liquidación, el subtítulo omite " núm. {n}".
 *
 * §D4: la factura NO expone `pieLegal` (la validez es del presupuesto, no de la factura).
 *
 * Hexagonal: `documentos` NO importa de `facturacion`; el desglose y el régimen llegan como
 * datos del documento. Solo importa su propio VO de dominio `ConfiguracionDocumentoTenant`.
 */
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';
import type {
  CabeceraModelo,
  ClienteDocumento,
  DesgloseDocumento,
  PieBancarioModelo,
  TotalesModelo,
} from './modelo-documento-presupuesto';
import { interpolarNombreComercial } from './modelo-documento-presupuesto';

/** Tipo de documento de cobro (§D-2). */
export type TipoDocumentoFactura = 'senal' | 'liquidacion' | 'fianza';

/** Un extra como sub-concepto de la factura con su subtotal (Decimal string de 2 decimales). */
export interface ExtraFactura {
  descripcion: string;
  subtotal: string;
}

/** DATOS de la FACTURA que alimentan el documento (ya resueltos, desglose congelado). */
export interface DatosDocumentoFactura {
  tipo: TipoDocumentoFactura;
  /** Número fiscal `F-YYYY-NNNN`; NULL en borrador (numeración diferida a la emisión). */
  numeroFactura: string | null;
  /** Fecha de emisión; NULL mientras la factura sigue en borrador. */
  fechaEmision: Date | null;
  /** Número del presupuesto de referencia (señal/liquidación); NULL si no aplica. */
  numeroPresupuesto: string | null;
  cliente: ClienteDocumento;
  /** Extras facturados como sub-conceptos (subtotal congelado). */
  extras: ReadonlyArray<ExtraFactura>;
  /** Desglose fiscal congelado en `facturacion` (`calcularDesgloseFactura`). */
  desglose: DesgloseDocumento;
  /** Idioma del documento (`'ca'`/`'es'`); ausente/desconocido cae a catalán. */
  idioma?: string;
}

/** Parámetros del builder del modelo de vista de la factura. */
export interface ConstruirModeloDocumentoFacturaParams {
  config: ConfiguracionDocumentoTenant;
  datos: DatosDocumentoFactura;
}

/** MODELO DE VISTA completo del documento de factura (todo resuelto). */
export interface ModeloDocumentoFactura {
  tipo: TipoDocumentoFactura;
  numeroFactura: string | null;
  fechaEmision: Date | null;
  numeroPresupuesto: string | null;
  cabecera: CabeceraModelo;
  cliente: ClienteDocumento;
  /**
   * Concepto PRINCIPAL (negrita). Señal/liquidación: desde `plantillaConceptoFiscal`
   * interpolada. Fianza: "Fiança de garantia — {nombreComercial}" (§D1).
   */
  concepto: string;
  /**
   * Línea de referencia indentada (no negrita) bajo el concepto principal (§D1): el 40/60
   * con prefijo asterisco. `null` en fianza (la fianza no lleva subtítulo).
   */
  conceptoSubtitulo: string | null;
  extras: ReadonlyArray<ExtraFactura>;
  totales: TotalesModelo;
  pieBancario: PieBancarioModelo;
  /** Idioma del documento (`'ca'`/`'es'`); el layout elige las etiquetas fijas. */
  idioma?: string;
}

/**
 * Concepto PRINCIPAL de la factura (§D1). Señal/liquidación: desde `plantillaConceptoFiscal`
 * interpolada con el nombre comercial (mismo helper que el presupuesto). Fianza: su concepto
 * propio "Fiança de garantia — {nombreComercial}" (SIN nº de presupuesto: la fianza es del
 * espacio, no del presupuesto), que NO cambia con este change.
 */
const resolverConceptoPrincipal = (
  tipo: TipoDocumentoFactura,
  config: ConfiguracionDocumentoTenant,
  idioma: string,
): string => {
  const nombreComercial = config.identidadFiscal.nombreComercial;
  if (tipo === 'fianza') {
    return idioma === 'es'
      ? `Fianza de garantía — ${nombreComercial}`
      : `Fiança de garantia — ${nombreComercial}`;
  }
  const plantilla =
    idioma === 'es'
      ? config.textos.plantillaConceptoFiscal.es
      : config.textos.plantillaConceptoFiscal.ca;
  return interpolarNombreComercial(plantilla, nombreComercial);
};

/**
 * Subtítulo de referencia (§D1): el 40/60 con prefijo asterisco, indentado y no negrita.
 * Señal y liquidación referencian el número de presupuesto (omitido si es null); la fianza
 * NO lleva subtítulo (`null`).
 */
const resolverConceptoSubtitulo = (
  tipo: TipoDocumentoFactura,
  numeroPresupuesto: string | null,
  idioma: string,
): string | null => {
  if (tipo === 'fianza') {
    return null;
  }
  const referencia = numeroPresupuesto === null ? '' : ` núm. ${numeroPresupuesto}`;
  if (idioma === 'es') {
    if (tipo === 'senal') {
      return `*40% del importe total anticipado del presupuesto${referencia}`;
    }
    return `*60% del importe restante del presupuesto${referencia}`;
  }
  if (tipo === 'senal') {
    return `*40% de l'import total anticipat del pressupost${referencia}`;
  }
  return `*60% de l'import restant del pressupost${referencia}`;
};

/**
 * Construye el modelo de vista de la factura a partir de la config del tenant + los datos de
 * la factura. PURA y determinista: todas las aserciones de CONTENIDO recaen aquí. Los flags
 * CON/SIN IVA se derivan del `ivaPorcentaje` del desglose (0.00 → SIN IVA), reutilizando la
 * misma semántica de 6.2 (identidad fiscal, desglose de IVA y pie bancario).
 */
export const construirModeloDocumentoFactura = ({
  config,
  datos,
}: ConstruirModeloDocumentoFacturaParams): ModeloDocumentoFactura => {
  const conIva = datos.desglose.ivaPorcentaje !== '0.00';
  return {
    tipo: datos.tipo,
    numeroFactura: datos.numeroFactura,
    fechaEmision: datos.fechaEmision,
    numeroPresupuesto: datos.numeroPresupuesto,
    cabecera: {
      soloTexto: config.branding.logoUrl === null,
      mostrarIdentidadFiscal: conIva,
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
    concepto: resolverConceptoPrincipal(datos.tipo, config, datos.idioma ?? 'ca'),
    conceptoSubtitulo: resolverConceptoSubtitulo(
      datos.tipo,
      datos.numeroPresupuesto,
      datos.idioma ?? 'ca',
    ),
    extras: datos.extras.map((extra) => ({
      descripcion: extra.descripcion,
      subtotal: extra.subtotal,
    })),
    totales: {
      mostrarDesgloseIva: conIva,
      baseImponible: datos.desglose.baseImponible,
      ivaPorcentaje: datos.desglose.ivaPorcentaje,
      ivaImporte: datos.desglose.ivaImporte,
      total: datos.desglose.total,
    },
    pieBancario: {
      mostrar: conIva,
      iban: config.banca.iban,
      beneficiario: config.banca.beneficiarioTransferencia,
      concepto: config.banca.conceptoTransferencia,
    },
    idioma: datos.idioma,
  };
};
