/**
 * TESTS del MODELO DE VISTA del documento de FACTURA (épico #6, rebanada 6.3
 * `documentos-facturas-pdf`) — capa de presentación de `documentos`. Fase TDD RED.
 * tasks.md TDD: `modelo-documento-factura.spec.ts` (nuevo).
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Modelo de vista y renderizado de
 * factura (rebanada 6.3)"; escenarios "señal CON IVA activa todos los bloques", "señal
 * SIN IVA desactiva identidad fiscal, IVA y pie", "fianza usa concepto sin referencia a
 * presupuesto", "liquidación CON IVA incluye concepto con nº presupuesto"); design.md §D-2
 * (conceptos por tipo) y §D-5 (flags CON/SIN IVA en el modelo de vista de factura). Reutiliza
 * la MISMA lógica de flags que `construirModeloDocumentoPresupuesto` de 6.2.
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`documentos/presentation/
 * modelo-documento-factura.ts`, nuevo):
 *   - función PURA `construirModeloDocumentoFactura(params)` que recibe la
 *     `ConfiguracionDocumentoTenant`, los datos de la factura (tipo, ivaPorcentaje, total,
 *     base, iva, numeroFactura, fechaEmision, extras), los datos del cliente y el
 *     `numeroPresupuesto`, y devuelve `ModeloDocumentoFactura`.
 *   - flags derivados de `ivaPorcentaje` (0 → SIN IVA): `cabecera.mostrarIdentidadFiscal`,
 *     `totales.mostrarDesgloseIva`, `pieBancario.mostrar` → false cuando ivaPorcentaje === 0.
 *   - `concepto` (principal) desde `plantillaConceptoFiscal` (señal/liquidación) o el texto
 *     propio de la fianza; el 40/60 se mueve a `conceptoSubtitulo` (change
 *     `factura-pdf-fiel-referencia`, §D1):
 *       señal      → subtítulo "*40% de l'import total anticipat del pressupost núm. {n}"
 *       liquidación→ subtítulo "*60% de l'import restant del pressupost núm. {n}"
 *       fianza     → concepto "Fiança de garantia — {nombreComercial}", subtítulo null
 *
 * ESTRATEGIA (idéntica a 6.1b/6.2): las aserciones de CONTENIDO recaen sobre la función
 * PURA `construirModeloDocumentoFactura` (determinista, sin react-pdf). La verificación
 * VISUAL real del PDF es del paso de integración (sesión principal).
 *
 * RED: `modelo-documento-factura.ts` aún NO existe: `construirModeloDocumentoFactura`, el
 * tipo `ModeloDocumentoFactura` y `DatosDocumentoFactura` no están definidos. El import
 * falla (TS/ausencia de implementación) y la batería está en ROJO. GREEN es de
 * `backend-developer`.
 */
import {
  construirModeloDocumentoFactura,
  type DatosDocumentoFactura,
  type ModeloDocumentoFactura,
} from '../modelo-documento-factura';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto (datos reales de 6.1a, sin logo).
// ---------------------------------------------------------------------------

const configPiloto = (logoUrl: string | null = null): ConfiguracionDocumentoTenant => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  branding: { logoUrl, colorPrimario: '#1A1A1A', colorTexto: '#333333' },
  identidadFiscal: {
    razonSocialFiscal: 'Canoliart, SL',
    nombreComercial: "Masia l'Encís",
    nif: 'B10874287',
    direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
    web: 'www.masialencis.com',
    email: 'info@masialencis.com',
  },
  banca: {
    iban: 'ES30 0182 1683 4002 0172 9599',
    beneficiarioTransferencia: 'Canoliart, SL',
    conceptoTransferencia: "Masia l'Encís",
  },
  textos: {
    plantillaConceptoFiscal: {
      ca: 'Gestió ús espai de {nombreComercial} per esdeveniment',
      es: 'Gestión de uso del espacio de {nombreComercial} para evento',
    },
    validesaTexto: { ca: '10 DIES', es: '10 DÍAS' },
    pieLegal: {
      ca: 'Aquest document té una validesa de 10 dies des de la seva emissió.',
      es: 'Este documento tiene una validez de 10 días desde su emisión.',
    },
  },
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [],
  },
});

const cliente = (): DatosDocumentoFactura['cliente'] => ({
  nombre: 'Anna',
  apellidos: 'Puig Soler',
  dniNif: '47123456Z',
  direccion: 'Carrer Major, 12',
  codigoPostal: '08720',
  poblacion: 'Vilafranca del Penedès',
  provincia: 'Barcelona',
});

/**
 * Datos de la FACTURA de señal CON IVA (ivaPorcentaje = 21). El total y el desglose
 * ENTRAN congelados (calculados en `facturacion` con `calcularDesgloseFactura`).
 */
const datosSenal = (
  overrides: Partial<DatosDocumentoFactura> = {},
): DatosDocumentoFactura => ({
  tipo: 'senal',
  numeroFactura: 'F-2026-0001',
  fechaEmision: new Date('2026-07-13T00:00:00.000Z'),
  numeroPresupuesto: '2026001',
  cliente: cliente(),
  extras: [],
  desglose: {
    baseImponible: '991.74',
    ivaPorcentaje: '21.00',
    ivaImporte: '208.26',
    total: '1200.00',
  },
  ...overrides,
});

/** La MISMA factura de señal, variante SIN IVA: base = total, iva 0, ivaPorcentaje 0. */
const datosSenalSinIva = (
  overrides: Partial<DatosDocumentoFactura> = {},
): DatosDocumentoFactura =>
  datosSenal({
    desglose: {
      baseImponible: '1200.00',
      ivaPorcentaje: '0.00',
      ivaImporte: '0.00',
      total: '1200.00',
    },
    ...overrides,
  });

const datosLiquidacion = (
  overrides: Partial<DatosDocumentoFactura> = {},
): DatosDocumentoFactura =>
  datosSenal({
    tipo: 'liquidacion',
    numeroFactura: null,
    extras: [{ descripcion: 'Neteja', subtotal: '100.00' }],
    ...overrides,
  });

const datosFianza = (
  overrides: Partial<DatosDocumentoFactura> = {},
): DatosDocumentoFactura =>
  datosSenal({
    tipo: 'fianza',
    numeroFactura: null,
    numeroPresupuesto: null,
    ...overrides,
  });

// ===========================================================================
// D-5/D-2 — SEÑAL CON IVA: flags true/true/true + concepto "40%…pressupost núm."
// ===========================================================================

describe('construirModeloDocumentoFactura — señal CON IVA activa todos los bloques', () => {
  it('debe_marcar_identidad_fiscal_desglose_iva_y_pie_bancario_en_true_con_iva', () => {
    const modelo: ModeloDocumentoFactura = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenal(),
    });

    expect(modelo.cabecera.mostrarIdentidadFiscal).toBe(true);
    expect(modelo.totales.mostrarDesgloseIva).toBe(true);
    expect(modelo.pieBancario.mostrar).toBe(true);
  });

  it('debe_generar_el_subtitulo_de_senal_con_el_40_por_ciento_y_el_numero_de_presupuesto', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenal({ numeroPresupuesto: '2026001' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*40% de l'import total anticipat del pressupost núm. 2026001",
    );
  });
});

// ===========================================================================
// D-5/D-2 — SEÑAL SIN IVA: flags false/false/false, MISMO concepto que CON IVA.
// ===========================================================================

describe('construirModeloDocumentoFactura — señal SIN IVA desactiva identidad fiscal, IVA y pie', () => {
  it('debe_marcar_identidad_fiscal_desglose_iva_y_pie_bancario_en_false_sin_iva', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenalSinIva(),
    });

    expect(modelo.cabecera.mostrarIdentidadFiscal).toBe(false);
    expect(modelo.totales.mostrarDesgloseIva).toBe(false);
    expect(modelo.pieBancario.mostrar).toBe(false);
  });

  it('debe_mantener_el_mismo_subtitulo_de_senal_en_sin_iva', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenalSinIva({ numeroPresupuesto: '2026001' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*40% de l'import total anticipat del pressupost núm. 2026001",
    );
  });
});

// ===========================================================================
// D-2 — LIQUIDACIÓN CON IVA: flags true/true/true, concepto "Saldo del 60%…pressupost núm.".
// ===========================================================================

describe('construirModeloDocumentoFactura — liquidación CON IVA incluye concepto con nº presupuesto', () => {
  it('debe_marcar_los_tres_flags_en_true_en_la_liquidacion_con_iva', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosLiquidacion(),
    });

    expect(modelo.cabecera.mostrarIdentidadFiscal).toBe(true);
    expect(modelo.totales.mostrarDesgloseIva).toBe(true);
    expect(modelo.pieBancario.mostrar).toBe(true);
  });

  it('debe_generar_el_subtitulo_de_liquidacion_con_el_saldo_del_60_y_el_numero_de_presupuesto', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosLiquidacion({ numeroPresupuesto: '2026001' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*60% de l'import restant del pressupost núm. 2026001",
    );
    // El número de presupuesto aparece en el subtítulo de la liquidación.
    expect(modelo.conceptoSubtitulo).toContain('2026001');
  });
});

// ===========================================================================
// D-2 — FIANZA: concepto "Fiança de garantia — {nombreComercial}", SIN nº presupuesto.
// ===========================================================================

describe('construirModeloDocumentoFactura — fianza usa concepto sin referencia a presupuesto', () => {
  it('debe_generar_el_concepto_de_fianza_con_el_nombre_comercial_del_tenant', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosFianza(),
    });

    expect(modelo.concepto).toBe("Fiança de garantia — Masia l'Encís");
  });

  it('no_debe_incluir_ningun_numero_de_presupuesto_en_el_concepto_de_fianza', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      // Aunque llegara un número, la fianza NO lo referencia (la fianza es del espacio).
      datos: datosFianza({ numeroPresupuesto: '2026001' }),
    });

    expect(modelo.concepto).not.toContain('2026001');
    expect(modelo.concepto).not.toContain('pressupost');
  });
});

// ===========================================================================
// IDIOMA — factura-senal-pdf-idioma-email-ux + factura-pdf-fiel-referencia (TDD RED).
//
// `DatosDocumentoFactura` incluye `idioma: string`. El builder
// `construirModeloDocumentoFactura` debe:
//   - derivar el `concepto` (principal) desde la plantilla en el idioma indicado,
//   - derivar el `conceptoSubtitulo` (40/60) en el idioma indicado.
// §D4: la factura ya NO expone `pieLegal` (la validez es del presupuesto), así que
// los antiguos asserts de pieLegal por idioma se retiran.
// ===========================================================================

describe('construirModeloDocumentoFactura — IDIOMA ES (subtítulo 40/60 por idioma)', () => {
  it('debe_generar_el_subtitulo_de_senal_en_espanol_cuando_idioma_es_es', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenal({ idioma: 'es', numeroPresupuesto: '2026001' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      '*40% del importe total anticipado del presupuesto núm. 2026001',
    );
  });

  it('debe_generar_el_subtitulo_de_liquidacion_en_espanol_cuando_idioma_es_es', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosLiquidacion({ idioma: 'es', numeroPresupuesto: '2026001' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      '*60% del importe restante del presupuesto núm. 2026001',
    );
  });

  it('debe_generar_el_concepto_de_fianza_en_espanol_cuando_idioma_es_es', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosFianza({ idioma: 'es' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.concepto).toBe("Fianza de garantía — Masia l'Encís");
    expect(modelo.conceptoSubtitulo).toBeNull();
  });
});

describe('construirModeloDocumentoFactura — IDIOMA CA (subtítulo 40/60 por idioma)', () => {
  it('debe_generar_el_subtitulo_de_senal_en_catalan_cuando_idioma_es_ca', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenal({ idioma: 'ca', numeroPresupuesto: '2026001' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*40% de l'import total anticipat del pressupost núm. 2026001",
    );
  });

  it('debe_generar_el_subtitulo_de_liquidacion_en_catalan_cuando_idioma_es_ca', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosLiquidacion({ idioma: 'ca', numeroPresupuesto: '2026001' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*60% de l'import restant del pressupost núm. 2026001",
    );
  });

  it('debe_generar_el_concepto_de_fianza_en_catalan_cuando_idioma_es_ca', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosFianza({ idioma: 'ca' } as Partial<DatosDocumentoFactura>),
    });

    expect(modelo.concepto).toBe("Fiança de garantia — Masia l'Encís");
    expect(modelo.conceptoSubtitulo).toBeNull();
  });
});

describe('construirModeloDocumentoFactura — IDIOMA propagado al modelo (factura-senal-pdf-idioma-email-ux)', () => {
  it('debe_exponer_idioma_en_el_modelo_de_vista', () => {
    const modelo = construirModeloDocumentoFactura({
      config: configPiloto(),
      datos: datosSenal({ idioma: 'es' } as Partial<DatosDocumentoFactura>),
    });

    // El modelo expone `idioma` para que DocumentoFacturaLayout seleccione etiquetas.
    expect((modelo as unknown as Record<string, unknown>).idioma).toBe('es');
  });
});
