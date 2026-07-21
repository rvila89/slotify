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
 * §D-2 (conceptos por tipo):
 *   señal      → "40% de l'import total anticipat del pressupost núm. {n}"
 *   liquidación→ "Saldo del 60% de l'import del pressupost núm. {n}"
 *   fianza     → "Fiança de garantia — {nombreComercial}" (SIN nº de presupuesto: la fianza
 *                es del espacio, no del presupuesto)
 * Cuando `numeroPresupuesto` es null en señal/liquidación, el concepto omite " núm. {n}".
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
  /** Concepto fiscal resuelto según el tipo (§D-2). */
  concepto: string;
  extras: ReadonlyArray<ExtraFactura>;
  totales: TotalesModelo;
  pieLegal: string;
  pieBancario: PieBancarioModelo;
  /** Idioma del documento (`'ca'`/`'es'`); el layout elige las etiquetas fijas. */
  idioma?: string;
}

/**
 * Resuelve el concepto fiscal según el tipo de factura (§D-2). Señal y liquidación referencian
 * el número de presupuesto (omitido si es null); la fianza es del espacio y NUNCA lo referencia.
 */
const resolverConcepto = (
  tipo: TipoDocumentoFactura,
  numeroPresupuesto: string | null,
  nombreComercial: string,
  idioma: string,
): string => {
  if (idioma === 'es') {
    if (tipo === 'fianza') {
      return `Fianza de garantía — ${nombreComercial}`;
    }
    const referencia = numeroPresupuesto === null ? '' : ` núm. ${numeroPresupuesto}`;
    if (tipo === 'senal') {
      return `40% del importe total anticipado del presupuesto${referencia}`;
    }
    return `Saldo del 60% del importe del presupuesto${referencia}`;
  }
  if (tipo === 'fianza') {
    return `Fiança de garantia — ${nombreComercial}`;
  }
  const referencia = numeroPresupuesto === null ? '' : ` núm. ${numeroPresupuesto}`;
  if (tipo === 'senal') {
    return `40% de l'import total anticipat del pressupost${referencia}`;
  }
  return `Saldo del 60% de l'import del pressupost${referencia}`;
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
    concepto: resolverConcepto(
      datos.tipo,
      datos.numeroPresupuesto,
      config.identidadFiscal.nombreComercial,
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
    pieLegal:
      datos.idioma === 'es' ? config.textos.pieLegal.es : config.textos.pieLegal.ca,
    pieBancario: {
      mostrar: conIva,
      iban: config.banca.iban,
      beneficiario: config.banca.beneficiarioTransferencia,
      concepto: config.banca.conceptoTransferencia,
    },
    idioma: datos.idioma,
  };
};
