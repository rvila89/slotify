/**
 * TESTS de la VARIANTE SIN IVA del documento de presupuesto (épico #6, rebanada 6.2
 * `documentos-presupuesto-sin-iva-doble-numeracion`) — fase TDD RED.
 * tasks.md Fase 3: 3.3.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Variante SIN IVA del documento
 * (cabecera sin identidad fiscal, totales sin base/IVA)"; escenarios "SIN IVA no muestra
 * base imponible ni desglose de IVA", "SIN IVA omite razón social fiscal y NIF pero
 * mantiene dirección/contacto", "CON IVA conserva el render de 6.1b", "El concepto y el
 * resto del cuerpo son idénticos en ambas variantes", "La variante no acopla documentos a
 * presupuestos"); design.md D3 (flags `cabecera.mostrarIdentidadFiscal` /
 * `totales.mostrarDesgloseIva` resueltos en el modelo de vista puro; layout fijo,
 * contenido por tenant; `documentos` NO importa de `presupuestos`, el enum de régimen se
 * declara en `documentos`).
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`documentos/presentation/
 * modelo-documento-presupuesto.ts`, extendido):
 *   - tipo `RegimenDocumento = 'con_iva' | 'sin_iva'` DECLARADO en `documentos` (NO se
 *     importa de `presupuestos`; el régimen llega como dato del documento).
 *   - `DatosDocumentoPresupuesto` gana `regimen: RegimenDocumento`.
 *   - `CabeceraModelo` gana `mostrarIdentidadFiscal: boolean` (true CON IVA, false SIN
 *     IVA). En SIN IVA `razonSocialFiscal`/`nif` NO se pintan (el flag lo gobierna).
 *   - `ModeloDocumentoPresupuesto.totales` gana `mostrarDesgloseIva: boolean` (true CON
 *     IVA, false SIN IVA). En SIN IVA `BloqueTotales` pinta SOLO el Total.
 *
 * ESTRATEGIA (idéntica a 6.1b): el grueso de las aserciones de CONTENIDO recae en la
 * función PURA `construirModeloDocumentoPresupuesto` (determinista, sin react-pdf);
 * `renderizarDocumentoPresupuestoABytes` solo se comprueba que produce bytes `%PDF` para
 * ambas variantes (react-pdf es ESM puro → corre con `NODE_OPTIONS=--experimental-vm-modules`).
 * La verificación VISUAL real del PDF SIN IVA es del paso de integración (sesión principal).
 *
 * RED: `construirModeloDocumentoPresupuesto` aún NO acepta `regimen` ni expone
 * `mostrarIdentidadFiscal`/`mostrarDesgloseIva`, y el tipo `RegimenDocumento` aún NO
 * existe. Los imports/propiedades fallan (TS) y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
  type ModeloDocumentoPresupuesto,
  type RegimenDocumento,
} from '../modelo-documento-presupuesto';
import { renderizarDocumentoPresupuestoABytes } from '../documento-presupuesto.render';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const CON_IVA: RegimenDocumento = 'con_iva';
const SIN_IVA: RegimenDocumento = 'sin_iva';

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
    plantillaConceptoFiscal: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    validesaTexto: '10 DIES',
    pieLegal: 'Aquest document té una validesa de 10 dies des de la seva emissió.',
  },
  condiciones: { titulo: 'Condicions Particulars', secciones: [] },
});

/**
 * Datos del documento. CON IVA: desglose con base+IVA+total (total = base+IVA21).
 * SIN IVA: el `total` congelado es la base sin IVA (importe MENOR), iva 0.
 */
const datosConIva = (
  overrides: Partial<DatosDocumentoPresupuesto> = {},
): DatosDocumentoPresupuesto => ({
  numeroPresupuesto: '2026001',
  fecha: new Date('2026-07-13T00:00:00.000Z'),
  regimen: CON_IVA,
  cliente: {
    nombre: 'Anna',
    apellidos: 'Puig Soler',
    dniNif: '47123456Z',
    direccion: 'Carrer Major, 12',
    codigoPostal: '08720',
    poblacion: 'Vilafranca del Penedès',
    provincia: 'Barcelona',
  },
  fechaEvento: new Date('2027-09-12T00:00:00.000Z'),
  duracionHoras: 8,
  numPersonas: 80,
  extras: [
    { descripcion: 'Neteja', importeEur: '100.00' },
    { descripcion: 'Barra lliure', importeEur: '450.00' },
  ],
  desglose: {
    baseImponible: '1000.00',
    ivaPorcentaje: '21.00',
    ivaImporte: '210.00',
    total: '1210.00',
  },
  reparto: { senalEur: '484.00', liquidacionEur: '726.00', fianzaEur: '500.00' },
  ...overrides,
});

/** El MISMO presupuesto, variante SIN IVA: base 1000 = total (importe menor), iva 0. */
const datosSinIva = (
  overrides: Partial<DatosDocumentoPresupuesto> = {},
): DatosDocumentoPresupuesto =>
  datosConIva({
    regimen: SIN_IVA,
    desglose: {
      baseImponible: '1000.00',
      ivaPorcentaje: '0.00',
      ivaImporte: '0.00',
      total: '1000.00',
    },
    reparto: { senalEur: '400.00', liquidacionEur: '600.00', fianzaEur: '500.00' },
    ...overrides,
  });

// ===========================================================================
// 3.3 — SIN IVA: totales SOLO-Total, sin base imponible ni desglose de IVA.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — SIN IVA sin base/IVA en totales (3.3)', () => {
  it('debe_marcar_mostrarDesgloseIva_false_en_sin_iva', () => {
    const modelo: ModeloDocumentoPresupuesto = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosSinIva(),
    );

    // El flag que gobierna que BloqueTotales pinte SOLO el Total (sin base ni IVA).
    expect(modelo.totales.mostrarDesgloseIva).toBe(false);
  });

  it('debe_exponer_el_total_igual_a_la_base_sin_iva_como_importe_menor', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    // SIN IVA: el total mostrado es la base (1000), sin el 21%.
    expect(modelo.totales.total).toBe('1000.00');
    expect(modelo.totales.ivaImporte).toBe('0.00');
    expect(modelo.totales.ivaPorcentaje).toBe('0.00');
  });
});

// ===========================================================================
// 3.3 — SIN IVA: cabecera OMITE razón social fiscal y NIF, MANTIENE dirección/
//        web/email y branding/nombre comercial.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — SIN IVA cabecera sin identidad fiscal (3.3)', () => {
  it('debe_marcar_mostrarIdentidadFiscal_false_en_sin_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    // El flag que gobierna que Cabecera NO pinte razón social fiscal + NIF.
    expect(modelo.cabecera.mostrarIdentidadFiscal).toBe(false);
  });

  it('debe_mantener_nombre_comercial_direccion_web_email_y_branding_en_sin_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto('https://cdn/logo.png'), datosSinIva());

    // Se mantiene el resto de la cabecera (D3: solo se omite razón social fiscal + NIF).
    expect(modelo.cabecera.nombreComercial).toBe("Masia l'Encís");
    expect(modelo.cabecera.direccionFiscal).toBe('08731 - Sant Martí Sarroca / Barcelona');
    expect(modelo.cabecera.web).toBe('www.masialencis.com');
    expect(modelo.cabecera.email).toBe('info@masialencis.com');
    expect(modelo.cabecera.logoUrl).toBe('https://cdn/logo.png');
    expect(modelo.cabecera.colorPrimario).toBe('#1A1A1A');
  });
});

// ===========================================================================
// 3.3 — CON IVA conserva el render de 6.1b (NO regresión): flags en true, base
//        e IVA presentes en totales, identidad fiscal en cabecera.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — CON IVA conserva el render de 6.1b (3.3)', () => {
  it('debe_marcar_ambos_flags_en_true_en_con_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());

    expect(modelo.cabecera.mostrarIdentidadFiscal).toBe(true);
    expect(modelo.totales.mostrarDesgloseIva).toBe(true);
  });

  it('debe_mostrar_razon_social_fiscal_nif_base_e_iva_en_con_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());

    expect(modelo.cabecera.razonSocialFiscal).toBe('Canoliart, SL');
    expect(modelo.cabecera.nif).toBe('B10874287');
    expect(modelo.totales.baseImponible).toBe('1000.00');
    expect(modelo.totales.ivaPorcentaje).toBe('21.00');
    expect(modelo.totales.ivaImporte).toBe('210.00');
    expect(modelo.totales.total).toBe('1210.00');
  });
});

// ===========================================================================
// 3.3 — El CUERPO (concepto/horas/personas/extras/reparto/validesa) es IDÉNTICO
//        en ambas variantes: solo cambian cabecera, totales y —desde el fix
//        `documentos-sin-iva-omite-pie-bancario`— la visibilidad del pie bancario
//        (`pieBancario.mostrar`).
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — cuerpo idéntico en ambas variantes (3.3)', () => {
  it('debe_producir_el_mismo_concepto_horas_personas_extras_validesa_y_pie_en_ambas_variantes', () => {
    const conIva = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());
    const sinIva = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    // Concepto "espai" (NUNCA "lloguer"), idéntico.
    expect(sinIva.conceptoPrincipal).toBe(conIva.conceptoPrincipal);
    expect(sinIva.conceptoPrincipal).toBe(
      "Gestió de l'ús espai de Masia l'Encís per esdeveniment",
    );
    // Duración "(N hores)", nº personas, extras, validesa y pie legal: idénticos.
    expect(sinIva.duracionTexto).toBe(conIva.duracionTexto);
    expect(sinIva.numPersonas).toBe(conIva.numPersonas);
    expect(sinIva.extras).toEqual(conIva.extras);
    expect(sinIva.validesaTexto).toBe(conIva.validesaTexto);
    expect(sinIva.pieLegal).toBe(conIva.pieLegal);
    // Los DATOS bancarios (iban/beneficiario/concepto) siguen poblados igual desde la
    // config en ambas variantes; solo cambia su visibilidad: SIN IVA lo OMITE (fix
    // `documentos-sin-iva-omite-pie-bancario`), CON IVA lo conserva.
    expect(sinIva.pieBancario.iban).toBe(conIva.pieBancario.iban);
    expect(sinIva.pieBancario.beneficiario).toBe(conIva.pieBancario.beneficiario);
    expect(sinIva.pieBancario.concepto).toBe(conIva.pieBancario.concepto);
    expect(sinIva.pieBancario.mostrar).toBe(false);
    expect(conIva.pieBancario.mostrar).toBe(true);
  });

  it('debe_mostrar_el_reparto_40_60_fianza_del_regimen_en_sin_iva', () => {
    // El reparto que pinta SIN IVA es el del régimen (40/60 sobre el total SIN IVA).
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    expect(modelo.reparto.senalEur).toBe('400.00');
    expect(modelo.reparto.liquidacionEur).toBe('600.00');
    expect(modelo.reparto.fianzaEur).toBe('500.00');
  });

  it('debe_no_contener_nunca_la_palabra_lloguer_en_la_variante_sin_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    const textoCompleto = JSON.stringify(modelo).toLowerCase();
    expect(textoCompleto).not.toContain('lloguer');
  });
});

// ===========================================================================
// 3.3 (B) — Render ligero: AMBAS variantes producen bytes de PDF (firma %PDF),
//            sin inspeccionar el binario. react-pdf ESM → --experimental-vm-modules.
// ===========================================================================

describe('renderizarDocumentoPresupuestoABytes — produce PDF en ambas variantes (3.3)', () => {
  it('debe_renderizar_la_variante_sin_iva_a_bytes_que_empiezan_por_%PDF', async () => {
    const bytes = await renderizarDocumentoPresupuestoABytes(configPiloto(), datosSinIva());

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });

  it('debe_renderizar_la_variante_con_iva_a_bytes_que_empiezan_por_%PDF_sin_regresion', async () => {
    const bytes = await renderizarDocumentoPresupuestoABytes(configPiloto(), datosConIva());

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });
});
