/**
 * TESTS del MODELO DE VISTA de FACTURA — concepto principal desde plantilla + nuevo campo
 * `conceptoSubtitulo` (change `factura-pdf-fiel-referencia`, épico #6 rebanada 6.3). Fase TDD
 * RED.
 *
 * Trazabilidad: spec-delta `documentos` — Requirement "Modelo de vista y renderizado de
 * factura (rebanada 6.3)"; escenarios:
 *   - "El modelo de vista de señal CON IVA activa todos los bloques" (concepto principal +
 *     subtítulo 40%),
 *   - "El concepto principal de liquidación usa plantilla y el subtítulo el 60%",
 *   - "El concepto principal en castellano usa la plantilla castellana",
 *   - "El subtítulo omite el número cuando no hay presupuesto",
 *   - "El modelo de vista de fianza no cambia y no lleva subtítulo".
 * design.md §D1 (concepto principal desde `plantillaConceptoFiscal`, subtítulo por tipo) y
 * §D4 (la factura NO expone pie legal de validez).
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`modelo-documento-factura.ts`):
 *   - `concepto` (principal, negrita) = `config.textos.plantillaConceptoFiscal.{idioma}`
 *     interpolando `{nombreComercial}` con `config.identidadFiscal.nombreComercial` (regla
 *     dura: expresa "espai", NUNCA "lloguer"). Es el MISMO texto que el concepto del
 *     presupuesto del tenant.
 *   - `conceptoSubtitulo: string | null` (indentado, no negrita):
 *       señal      → "*40% de l'import total anticipat del pressupost núm. {n}" (ca) /
 *                    "*40% del importe total anticipado del presupuesto núm. {n}" (es)
 *       liquidación→ "*60% de l'import restant del pressupost núm. {n}" (ca) /
 *                    "*60% del importe restante del presupuesto núm. {n}" (es)
 *       fianza     → null
 *       numeroPresupuesto=null → se OMITE " núm. {n}".
 *   - El modelo de factura NO expone `pieLegal` (§D4: se elimina del modelo de factura).
 *
 * ESTRATEGIA: las aserciones de CONTENIDO recaen sobre la función PURA
 * `construirModeloDocumentoFactura` (determinista, sin react-pdf). Se usa la config REAL del
 * tenant piloto (`construirConfiguracionDocumentoPiloto`), cuya `plantillaConceptoFiscal.ca`
 * es "Gestió ús espai de {nombreComercial} per esdeveniment" y `nombreComercial` es
 * "Masia l'Encís".
 *
 * RED esperado (por la razón correcta): hoy `construirModeloDocumentoFactura` pone en
 * `concepto` el texto 40/60 (no la plantilla), NO expone `conceptoSubtitulo` (es `undefined`)
 * y SÍ expone `pieLegal`. Por tanto:
 *   - `concepto === "Gestió ús espai de Masia l'Encís per esdeveniment"` FALLA (hoy es el 40%),
 *   - `conceptoSubtitulo === "*40%…"` FALLA (hoy es `undefined`),
 *   - `pieLegal === undefined` FALLA (hoy está poblado).
 * GREEN es de `backend-developer`.
 */
import {
  construirModeloDocumentoFactura,
  type DatosDocumentoFactura,
} from '../modelo-documento-factura';
import { construirConfiguracionDocumentoPiloto } from '../../infrastructure/seed/configuracion-documento-piloto';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const config = () => construirConfiguracionDocumentoPiloto(TENANT_ID);

// Concepto principal esperado (plantilla interpolada con nombreComercial = "Masia l'Encís").
const CONCEPTO_PRINCIPAL_CA = "Gestió ús espai de Masia l'Encís per esdeveniment";
const CONCEPTO_PRINCIPAL_ES = "Gestión de uso del espacio de Masia l'Encís para evento";

const cliente = (): DatosDocumentoFactura['cliente'] => ({
  nombre: 'Sergio',
  apellidos: 'Carrasco',
  dniNif: '47123456Z',
  direccion: 'Carrer Major, 12',
  codigoPostal: '08720',
  poblacion: 'Vilafranca del Penedès',
  provincia: 'Barcelona',
});

const datosSenal = (
  overrides: Partial<DatosDocumentoFactura> = {},
): DatosDocumentoFactura => ({
  tipo: 'senal',
  numeroFactura: 'F2026029',
  fechaEmision: new Date('2026-07-13T00:00:00.000Z'),
  numeroPresupuesto: 'P2026029',
  cliente: cliente(),
  extras: [],
  desglose: {
    baseImponible: '991.74',
    ivaPorcentaje: '21.00',
    ivaImporte: '208.26',
    total: '1200.00',
  },
  idioma: 'ca',
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
// D1 — SEÑAL: concepto principal desde plantilla + subtítulo 40% con nº presupuesto.
// ===========================================================================

describe('construirModeloDocumentoFactura — concepto principal y subtítulo de SEÑAL (ca)', () => {
  it('debe_poner_el_concepto_principal_desde_la_plantilla_del_tenant_en_catalan', () => {
    // Arrange / Act
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'ca', numeroPresupuesto: 'P2026029' }),
    });

    // Assert — concepto principal = plantilla interpolada (NUNCA "lloguer").
    expect(modelo.concepto).toBe(CONCEPTO_PRINCIPAL_CA);
    expect(modelo.concepto).not.toContain('lloguer');
  });

  it('debe_poner_el_subtitulo_de_senal_con_el_asterisco_el_40_y_el_numero_de_presupuesto', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'ca', numeroPresupuesto: 'P2026029' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*40% de l'import total anticipat del pressupost núm. P2026029",
    );
  });
});

// ===========================================================================
// D1 — SEÑAL (es): concepto principal castellano + subtítulo 40% castellano.
// ===========================================================================

describe('construirModeloDocumentoFactura — concepto principal y subtítulo de SEÑAL (es)', () => {
  it('debe_poner_el_concepto_principal_desde_la_plantilla_castellana', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'es', numeroPresupuesto: 'P2026029' }),
    });

    expect(modelo.concepto).toBe(CONCEPTO_PRINCIPAL_ES);
    expect(modelo.concepto).not.toContain('lloguer');
  });

  it('debe_poner_el_subtitulo_de_senal_en_castellano_con_el_40_y_el_numero_de_presupuesto', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'es', numeroPresupuesto: 'P2026029' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      '*40% del importe total anticipado del presupuesto núm. P2026029',
    );
  });
});

// ===========================================================================
// D1 — LIQUIDACIÓN (ca): concepto principal de plantilla + subtítulo "Saldo del 60%…".
// ===========================================================================

describe('construirModeloDocumentoFactura — concepto principal y subtítulo de LIQUIDACIÓN (ca)', () => {
  it('debe_usar_la_plantilla_como_concepto_principal_de_la_liquidacion', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosLiquidacion({ idioma: 'ca', numeroPresupuesto: 'P2026029' }),
    });

    expect(modelo.concepto).toBe(CONCEPTO_PRINCIPAL_CA);
  });

  it('debe_poner_el_subtitulo_de_liquidacion_con_el_saldo_del_60_y_el_numero_de_presupuesto', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosLiquidacion({ idioma: 'ca', numeroPresupuesto: 'P2026029' }),
    });

    expect(modelo.conceptoSubtitulo).toBe(
      "*60% de l'import restant del pressupost núm. P2026029",
    );
  });
});

// ===========================================================================
// D1 — numeroPresupuesto = null: el subtítulo OMITE " núm. {n}".
// ===========================================================================

describe('construirModeloDocumentoFactura — subtítulo omite el número cuando no hay presupuesto', () => {
  it('no_debe_incluir_num_en_el_subtitulo_de_senal_cuando_numeroPresupuesto_es_null', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'ca', numeroPresupuesto: null }),
    });

    expect(modelo.conceptoSubtitulo).not.toBeNull();
    expect(modelo.conceptoSubtitulo).not.toContain(' núm. ');
    // El asterisco y el 40% siguen presentes; solo se omite la referencia al presupuesto.
    expect(modelo.conceptoSubtitulo).toContain('40%');
  });
});

// ===========================================================================
// D1 — FIANZA: concepto propio de la fianza, subtítulo null (la fianza no cambia).
// ===========================================================================

describe('construirModeloDocumentoFactura — fianza mantiene su concepto y no lleva subtítulo', () => {
  it('debe_mantener_el_concepto_de_fianza_con_el_nombre_comercial_y_subtitulo_null', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosFianza({ idioma: 'ca' }),
    });

    expect(modelo.concepto).toBe("Fiança de garantia — Masia l'Encís");
    expect(modelo.conceptoSubtitulo).toBeNull();
  });
});

// ===========================================================================
// D4 — La factura NO expone pie legal de validez (se elimina del modelo).
// ===========================================================================

describe('construirModeloDocumentoFactura — el modelo de factura NO expone pie legal (D4)', () => {
  it('no_debe_exponer_pieLegal_en_el_modelo_de_la_factura', () => {
    const modelo = construirModeloDocumentoFactura({
      config: config(),
      datos: datosSenal({ idioma: 'ca' }),
    });

    // §D4: el campo `pieLegal` se elimina del modelo de factura (la validez es del
    // presupuesto). Se comprueba sobre el objeto en crudo (el tipo ya no debe declararlo).
    expect((modelo as unknown as Record<string, unknown>).pieLegal).toBeUndefined();
  });
});
