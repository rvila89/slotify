/**
 * TESTS del FIX "SIN IVA omite el pie de datos bancarios" (épico #6, fix apilado sobre
 * la rebanada 6.2 `documentos-sin-iva-omite-pie-bancario`) — fase TDD RED.
 * tasks.md Fase 2: 2.1, 2.2, 2.3, 2.4.
 *
 * Objetivo del fix (verificado contra el Excel real: la hoja "PRESSUPOST SENSE IVA" NO
 * lleva bloque bancario): la variante SIN IVA del documento de presupuesto OMITE el pie
 * de datos bancarios (IBAN + beneficiario + concepto/texto de transferencia); CON IVA lo
 * CONSERVA (sin regresión).
 *
 * Trazabilidad: design.md D1 (flag `pieBancario.mostrar: boolean` co-localizado en
 * `PieBancarioModelo`, resuelto en `construirModeloDocumentoPresupuesto` como
 * `datos.regimen === 'con_iva'`, igual patrón que `cabecera.mostrarIdentidadFiscal` y
 * `totales.mostrarDesgloseIva` de la 6.2), D2 (`DocumentoLayout` solo compone
 * `<PieBancario>` cuando `modelo.pieBancario.mostrar === true`), Riesgo/regresión
 * (CON IVA conserva cabecera, totales y pie bancario).
 *
 * FIRMA QUE FIJA ESTE TEST para la implementación (`documentos/presentation/
 * modelo-documento-presupuesto.ts`, extendido):
 *   - `PieBancarioModelo` gana `mostrar: boolean` (true CON IVA, false SIN IVA):
 *       export interface PieBancarioModelo {
 *         mostrar: boolean;
 *         iban: string;
 *         beneficiario: string;
 *         concepto: string;
 *       }
 *   - `construirModeloDocumentoPresupuesto` lo resuelve como `datos.regimen === 'con_iva'`
 *     (declarativo, sin condicionales dispersos; toda la lógica de variante en la pura).
 *
 * ESTRATEGIA (idéntica a 6.1b/6.2): el grueso de las aserciones de CONTENIDO recae en la
 * función PURA `construirModeloDocumentoPresupuesto` (determinista, sin react-pdf). La
 * AUSENCIA del pie bancario en SIN IVA se comprueba sobre la ESTRUCTURA del modelo
 * (flag `mostrar === false` + inexistencia del IBAN/concepto/beneficiario en la parte del
 * modelo que el layout compondría), evitando el falso positivo del `Canoliart` de la
 * cabecera CON IVA. `renderizarDocumentoPresupuestoABytes` solo se comprueba que produce
 * bytes `%PDF` (react-pdf es ESM puro → corre con `NODE_OPTIONS=--experimental-vm-modules`;
 * la verificación VISUAL real del PDF es del paso de integración de la sesión principal).
 *
 * RED: `PieBancarioModelo` aún NO expone `mostrar`, y `construirModeloDocumentoPresupuesto`
 * aún NO lo resuelve. Las aserciones de `modelo.pieBancario.mostrar` fallan (TS: la
 * propiedad no existe; y en runtime `undefined !== false/true`). La batería está en ROJO
 * por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
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

// Constantes del pie bancario del tenant piloto (Excel real): el IBAN y el concepto de
// transferencia son únicos del pie; el beneficiario coincide con la razón social fiscal
// (`Canoliart, SL`), por lo que las aserciones de ausencia usan el IBAN y el concepto
// para no dar falso positivo con el `Canoliart` de la cabecera CON IVA.
const IBAN_PILOTO = 'ES30 0182 1683 4002 0172 9599';
const BENEFICIARIO_PILOTO = 'Canoliart, SL';
const CONCEPTO_TRANSFERENCIA_PILOTO = "Masia l'Encís";

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto (datos reales de 6.1a, sin logo). Idénticos a los
// specs vecinos (6.1b / 6.2) para reutilizar configPiloto + datosConIva/datosSinIva.
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
    iban: IBAN_PILOTO,
    beneficiarioTransferencia: BENEFICIARIO_PILOTO,
    conceptoTransferencia: CONCEPTO_TRANSFERENCIA_PILOTO,
  },
  textos: {
    plantillaConceptoFiscal: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    validesaTexto: '10 DIES',
    pieLegal: 'Aquest document té una validesa de 10 dies des de la seva emissió.',
  },
});

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
// 2.1 — Modelo SIN IVA: el flag del pie bancario es false (se OMITE).
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — SIN IVA omite el pie bancario (2.1)', () => {
  it('debe_marcar_pieBancario_mostrar_false_en_sin_iva', () => {
    // Arrange
    const config = configPiloto();
    const datos = datosSinIva();

    // Act
    const modelo: ModeloDocumentoPresupuesto = construirModeloDocumentoPresupuesto(
      config,
      datos,
    );

    // Assert — el flag que gobierna que DocumentoLayout NO componga <PieBancario>.
    expect(modelo.pieBancario.mostrar).toBe(false);
  });
});

// ===========================================================================
// 2.2 — Modelo CON IVA: el flag es true y el pie CONSERVA iban/beneficiario/
//        concepto (sin regresión).
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — CON IVA conserva el pie bancario (2.2)', () => {
  it('debe_marcar_pieBancario_mostrar_true_en_con_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());

    expect(modelo.pieBancario.mostrar).toBe(true);
  });

  it('debe_conservar_iban_beneficiario_y_concepto_en_con_iva_sin_regresion', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());

    // El pie sigue trayendo los datos del tenant (no se vacía; solo se gobierna su render).
    expect(modelo.pieBancario.iban).toBe(IBAN_PILOTO);
    expect(modelo.pieBancario.beneficiario).toBe(BENEFICIARIO_PILOTO);
    expect(modelo.pieBancario.concepto).toBe(CONCEPTO_TRANSFERENCIA_PILOTO);
  });
});

// ===========================================================================
// 2.3 — Plantilla SIN IVA (estructura del modelo que el layout compondría): el
//        contenido NO expone IBAN ni concepto de transferencia. La aserción de
//        ausencia recae en el MODELO (coherente con los specs vecinos), evitando
//        el falso positivo del `Canoliart` de la cabecera CON IVA usando el IBAN
//        y el concepto de transferencia (que solo viven en el pie).
// ===========================================================================

describe('plantilla SIN IVA — el pie bancario no se compone (2.3)', () => {
  it('debe_omitir_el_pie_bancario_por_flag_mostrar_false_en_sin_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    // D2: el layout no compone <PieBancario> cuando mostrar === false → sin IBAN en el PDF.
    expect(modelo.pieBancario.mostrar).toBe(false);
  });

  it('debe_no_exponer_iban_ni_concepto_de_transferencia_en_el_bloque_pie_de_sin_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosSinIva());

    // Enfoque de estructura: cuando mostrar === false el pie no se pinta. Comprobamos que
    // el IBAN (identificador ÚNICO del pie, no presente en cabecera ni cuerpo) no se filtra
    // a ninguna otra sección componible del modelo. Se serializa el modelo SIN el sub-árbol
    // del pie (que el layout omite) y se verifica que el IBAN NO aparece en el resto del
    // documento. NOTA: el `conceptoTransferencia` del tenant piloto coincide con el nombre
    // comercial (`Masia l'Encís`) —que sí vive en cabecera/concepto—, por lo que NO sirve
    // como marcador de ausencia; el IBAN sí es exclusivo del pie.
    const { pieBancario, ...restoDelModelo } = modelo;
    expect(pieBancario.mostrar).toBe(false);

    const contenidoRenderizable = JSON.stringify(restoDelModelo);
    expect(contenidoRenderizable).not.toContain(IBAN_PILOTO);
  });
});

// ===========================================================================
// 2.4 — Plantilla CON IVA (no-regresión): el pie SÍ se compone (mostrar === true)
//        y trae IBAN + beneficiario + concepto.
// ===========================================================================

describe('plantilla CON IVA — el pie bancario SÍ se compone (2.4)', () => {
  it('debe_componer_el_pie_bancario_con_iban_beneficiario_y_concepto_en_con_iva', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosConIva());

    // Guardarraíl de no-regresión: CON IVA conserva el pie bancario íntegro.
    expect(modelo.pieBancario.mostrar).toBe(true);
    expect(modelo.pieBancario.iban).toBe(IBAN_PILOTO);
    expect(modelo.pieBancario.beneficiario).toBe(BENEFICIARIO_PILOTO);
    expect(modelo.pieBancario.concepto).toBe(CONCEPTO_TRANSFERENCIA_PILOTO);
  });
});

// ===========================================================================
// (B) — Render ligero: AMBAS variantes producen bytes de PDF (firma %PDF), sin
//        inspeccionar el binario. react-pdf ESM → --experimental-vm-modules.
// ===========================================================================

describe('renderizarDocumentoPresupuestoABytes — pie bancario condicional produce PDF', () => {
  it('debe_renderizar_la_variante_sin_iva_sin_pie_bancario_a_bytes_que_empiezan_por_%PDF', async () => {
    const bytes = await renderizarDocumentoPresupuestoABytes(configPiloto(), datosSinIva());

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });

  it('debe_renderizar_la_variante_con_iva_con_pie_bancario_a_bytes_que_empiezan_por_%PDF', async () => {
    const bytes = await renderizarDocumentoPresupuestoABytes(configPiloto(), datosConIva());

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });
});
