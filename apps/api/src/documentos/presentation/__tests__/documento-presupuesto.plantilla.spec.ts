/**
 * TESTS de la CAPA DE PLANTILLA de documentos react-pdf (épico #6, rebanada 6.1b
 * `documentos-presupuesto-pdf-con-iva`) — fase TDD RED. tasks.md Fase 2: 2.2.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Capa de plantilla de documentos
 * react-pdf reutilizable"; Requirement "Cabecera solo-texto cuando no hay logo del
 * tenant"), spec-delta `presupuestos` (Requirement "Contenido del PDF de presupuesto
 * tomado de la config del tenant"; escenarios "El concepto fiscal usa la plantilla del
 * tenant y nunca lloguer", "Los extras aparecen como sub-conceptos con precio"),
 * design.md (capa en `documentos/presentation/`, layout fijo/contenido por tenant, N3
 * cabecera solo-texto, N5 solo "(N hores)").
 *
 * ESTRATEGIA DE TEST DEL RENDER (documentada, decidida en TDD-RED):
 * El árbol react-pdf renderizado a bytes es un binario opaco: extraer texto del PDF
 * es frágil y acopla el test al motor de layout. Se separa la responsabilidad en dos:
 *
 *   (A) FUNCIÓN PURA `construirModeloDocumentoPresupuesto(config, datos)` que resuelve
 *       el "modelo de vista" del documento (todos los textos/valores ya resueltos:
 *       concepto con `{nombreComercial}` sustituido, "(N hores)", flag de cabecera
 *       solo-texto, base/%IVA/total, IBAN, validesa, extras como sub-conceptos). El
 *       grueso de las aserciones de CONTENIDO recae aquí — es determinista y sin
 *       dependencia de react-pdf, así que se puede snapshotear/assertar con confianza.
 *       Es también la frontera que reutilizará la factura de 6.3 (otro builder de
 *       "datos del documento" alimentando el mismo layout).
 *
 *   (B) TEST LIGERO de que `renderizarDocumentoPresupuestoABytes(config, datos)` (que
 *       compone `DocumentoLayout` + sub-componentes y llama a `renderToBuffer`)
 *       produce un `Uint8Array` no vacío que empieza por la firma `%PDF`. NO se
 *       inspecciona el texto del binario; la verificación de textos vive en (A) y la
 *       verificación VISUAL real es del paso de integración (tasks.md Fase 5, N6).
 *
 * RED: aún NO existen `documentos/presentation/modelo-documento-presupuesto.ts` ni
 * `documentos/presentation/documento-presupuesto.render.ts`. Los imports fallan
 * (TS2307) y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer` (incluye instalar `@react-pdf/renderer` y habilitar `.tsx`).
 */
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
  type ModeloDocumentoPresupuesto,
} from '../modelo-documento-presupuesto';
import { renderizarDocumentoPresupuestoABytes } from '../documento-presupuesto.render';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto (datos reales de 6.1a, sin logo) + un
// segundo tenant con datos DISTINTOS (para el escenario "no hardcodea negocio").
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
      ca: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
      es: 'Gestión del uso del espacio de {nombreComercial} para evento',
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

const configOtroTenant = (): ConfiguracionDocumentoTenant => ({
  tenantId: '00000000-0000-0000-0000-0000000000ff',
  branding: { logoUrl: null, colorPrimario: '#00509E', colorTexto: '#111111' },
  identidadFiscal: {
    razonSocialFiscal: 'Eventos Norte, SA',
    nombreComercial: 'Finca del Roble',
    nif: 'A99887766',
    direccionFiscal: '48001 - Bilbao / Bizkaia',
    web: 'www.fincadelroble.es',
    email: 'hola@fincadelroble.es',
  },
  banca: {
    iban: 'ES91 2100 0418 4502 0005 1332',
    beneficiarioTransferencia: 'Eventos Norte, SA',
    conceptoTransferencia: 'Finca del Roble',
  },
  textos: {
    plantillaConceptoFiscal: {
      ca: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
      es: 'Gestión del uso del espacio de {nombreComercial} para evento',
    },
    validesaTexto: { ca: '15 DIES', es: '15 DÍAS' },
    pieLegal: { ca: 'Validesa 15 dies.', es: 'Validez 15 días.' },
  },
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [],
  },
});

const datosPresupuesto = (
  overrides: Partial<DatosDocumentoPresupuesto> = {},
): DatosDocumentoPresupuesto => ({
  numeroPresupuesto: '2026001',
  fecha: new Date('2026-07-13T00:00:00.000Z'),
  // 6.2: régimen obligatorio; estos escenarios de 6.1b son la variante CON IVA.
  regimen: 'con_iva',
  // Mejora 3: idioma catalán (estos escenarios verifican el contenido catalán vivo).
  idioma: 'ca',
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
  horario: '12:00',
  duracionHoras: 8,
  numPersonas: 80,
  extras: [
    { descripcion: 'Neteja', importeEur: '100.00' },
    { descripcion: 'Barra lliure', importeEur: '450.00' },
  ],
  desglose: {
    baseImponible: '4132.23',
    ivaPorcentaje: '21.00',
    ivaImporte: '867.77',
    total: '5000.00',
  },
  reparto: { senalEur: '2000.00', liquidacionEur: '3000.00', fianzaEur: '300.00' },
  ...overrides,
});

// ===========================================================================
// 2.2 (A) — Modelo de vista: contenido resuelto desde la config + datos.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — concepto fiscal del tenant (2.2)', () => {
  it('debe_resolver_el_placeholder_nombreComercial_en_el_concepto_fiscal', () => {
    // Arrange
    const config = configPiloto();
    const datos = datosPresupuesto();

    // Act
    const modelo: ModeloDocumentoPresupuesto = construirModeloDocumentoPresupuesto(
      config,
      datos,
    );

    // Assert — {nombreComercial} sustituido por el valor real del tenant.
    expect(modelo.conceptoPrincipal).toBe(
      "Gestió de l'ús espai de Masia l'Encís per esdeveniment",
    );
    expect(modelo.conceptoPrincipal).not.toContain('{nombreComercial}');
  });

  it('debe_no_contener_nunca_la_palabra_lloguer_en_todo_el_modelo', () => {
    // Regla dura del épico: el concepto expresa "espai", NUNCA "lloguer".
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    const textoCompleto = JSON.stringify(modelo).toLowerCase();
    expect(textoCompleto).not.toContain('lloguer');
  });
});

describe('construirModeloDocumentoPresupuesto — cabecera / identidad fiscal (2.2)', () => {
  it('debe_marcar_cabecera_solo_texto_cuando_logoUrl_es_null', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(null),
      datosPresupuesto(),
    );

    expect(modelo.cabecera.soloTexto).toBe(true);
    expect(modelo.cabecera.logoUrl).toBeNull();
  });

  it('debe_incluir_el_logo_en_la_cabecera_cuando_logoUrl_esta_presente', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto('https://cdn/logo.png'),
      datosPresupuesto(),
    );

    expect(modelo.cabecera.soloTexto).toBe(false);
    expect(modelo.cabecera.logoUrl).toBe('https://cdn/logo.png');
  });

  it('debe_tomar_la_identidad_fiscal_de_la_config_del_tenant', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.cabecera.razonSocialFiscal).toBe('Canoliart, SL');
    expect(modelo.cabecera.nif).toBe('B10874287');
    expect(modelo.cabecera.direccionFiscal).toBe('08731 - Sant Martí Sarroca / Barcelona');
    expect(modelo.cabecera.email).toBe('info@masialencis.com');
    expect(modelo.cabecera.web).toBe('www.masialencis.com');
  });
});

describe('construirModeloDocumentoPresupuesto — duración "(N hores)" sin hora de inicio (2.2)', () => {
  it.each([
    [4, '(4 hores)'],
    [8, '(8 hores)'],
    [12, '(12 hores)'],
  ])('debe_mostrar_%s_horas_como_%s', (duracion, esperado) => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ duracionHoras: duracion }),
    );

    // N5: solo "(N hores)" desde duracionHoras; NO hay rango horario.
    expect(modelo.duracionTexto).toBe(esperado);
  });
});

describe('construirModeloDocumentoPresupuesto — extras como sub-conceptos (2.2)', () => {
  it('debe_listar_cada_extra_con_su_descripcion_y_precio', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.extras).toEqual([
      { descripcion: 'Neteja', importeEur: '100.00' },
      { descripcion: 'Barra lliure', importeEur: '450.00' },
    ]);
  });
});

describe('construirModeloDocumentoPresupuesto — totales CON IVA + validesa (2.2)', () => {
  it('debe_exponer_base_imponible_porcentaje_iva_y_total_del_desglose', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.totales.baseImponible).toBe('4132.23');
    expect(modelo.totales.ivaPorcentaje).toBe('21.00');
    expect(modelo.totales.total).toBe('5000.00');
  });

  it('debe_tomar_el_texto_de_validesa_de_la_config_del_tenant', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.validesaTexto).toBe('10 DIES');
  });

  it('debe_exponer_el_reparto_40_60_fianza_para_las_condicions', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.reparto.senalEur).toBe('2000.00');
    expect(modelo.reparto.liquidacionEur).toBe('3000.00');
    expect(modelo.reparto.fianzaEur).toBe('300.00');
  });
});

describe('construirModeloDocumentoPresupuesto — pie bancario del tenant (2.2)', () => {
  it('debe_exponer_el_IBAN_y_beneficiario_de_la_config_del_tenant', () => {
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());

    expect(modelo.pieBancario.iban).toBe('ES30 0182 1683 4002 0172 9599');
    expect(modelo.pieBancario.beneficiario).toBe('Canoliart, SL');
  });
});

describe('construirModeloDocumentoPresupuesto — no hardcodea negocio (2.2)', () => {
  it('debe_reflejar_datos_distintos_para_tenants_distintos_sin_valores_compartidos', () => {
    // Escenario "La plantilla no hardcodea contenido de negocio".
    const modeloA = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());
    const modeloB = construirModeloDocumentoPresupuesto(
      configOtroTenant(),
      datosPresupuesto(),
    );

    expect(modeloA.cabecera.razonSocialFiscal).not.toBe(modeloB.cabecera.razonSocialFiscal);
    expect(modeloA.pieBancario.iban).not.toBe(modeloB.pieBancario.iban);
    expect(modeloB.cabecera.razonSocialFiscal).toBe('Eventos Norte, SA');
    expect(modeloB.conceptoPrincipal).toBe(
      "Gestió de l'ús espai de Finca del Roble per esdeveniment",
    );
    expect(modeloB.pieBancario.iban).toBe('ES91 2100 0418 4502 0005 1332');
  });
});

// ===========================================================================
// 2.2 (B) — Render ligero: produce bytes de PDF (firma %PDF), sin inspeccionar
//            el texto del binario.
// ===========================================================================

describe('renderizarDocumentoPresupuestoABytes — produce un PDF real (2.2)', () => {
  it('debe_devolver_bytes_no_vacios_que_empiezan_por_la_firma_%PDF', async () => {
    // Arrange
    const config = configPiloto();
    const datos = datosPresupuesto();

    // Act
    const bytes = await renderizarDocumentoPresupuestoABytes(config, datos);

    // Assert — bytes no vacíos y firma de PDF (%PDF = 0x25 0x50 0x44 0x46).
    expect(bytes.length).toBeGreaterThan(0);
    const firma = Buffer.from(bytes.slice(0, 4)).toString('latin1');
    expect(firma).toBe('%PDF');
  });

  it('debe_renderizar_sin_error_la_cabecera_solo_texto_cuando_no_hay_logo', async () => {
    // N3: logoUrl null no debe romper el render.
    const bytes = await renderizarDocumentoPresupuestoABytes(
      configPiloto(null),
      datosPresupuesto(),
    );

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });
});
