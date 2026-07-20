/**
 * TESTS del BUILDER puro `construirModeloDocumentoPresupuesto` para el change
 * `pdf-presupuesto-horario-idioma` — fase TDD RED (tasks.md 3.1, 3.2, 3.5, 3.6).
 *
 * Trazabilidad:
 *  - spec-delta `documentos` — Requirement "Fecha y horario legibles del evento en el
 *    bloque de concepto", "Idioma del documento de presupuesto según el idioma del
 *    cliente", "Textos libres del tenant bilingües (es/ca)".
 *  - spec-delta `presupuestos` — Requirement "Contenido del PDF de presupuesto tomado
 *    de la config del tenant" (fecha con año, rango horario, idioma del cliente).
 *  - design.md D1 (horaFin `mod 1440`), D2 (i18n en el modelo de vista, sin `Intl`),
 *    D3 (textos libres bilingües `{ca,es}`).
 *
 * CONTRATO NUEVO QUE ESTOS TESTS ESPERAN (a implementar por backend-developer en GREEN):
 *  - `DatosDocumentoPresupuesto` gana `idioma: 'es' | 'ca'` y `horario: string | null`.
 *  - El VO `ConfiguracionDocumentoTenant.textos` pasa a bilingüe:
 *      plantillaConceptoFiscal / validesaTexto / pieLegal → { ca: string; es: string }.
 *  - `ModeloDocumentoPresupuesto` gana:
 *      · `fechaEventoTexto: string`  → "D de <mes> de AAAA" en el idioma del cliente.
 *      · `horarioTexto: string`      → "De HH:MM a HH:MM (N <hores|horas>)" o fallback.
 *      · `etiquetas`                 → etiquetas fijas resueltas por idioma (objeto).
 *    y `conceptoPrincipal` / `validesaTexto` / `pieLegal` se eligen por `datos.idioma`.
 *
 * RED: hoy `DatosDocumentoPresupuesto` NO tiene `idioma`/`horario`, `textos` es de
 * strings monolingües, y el modelo NO expone `fechaEventoTexto`/`horarioTexto`/
 * `etiquetas`. Falla por AUSENCIA DE IMPLEMENTACIÓN (TS + aserciones), no por sintaxis.
 * GREEN es de `backend-developer`.
 */
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
} from '../modelo-documento-presupuesto';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto con TEXTOS LIBRES BILINGÜES { ca, es }.
// ---------------------------------------------------------------------------

const configPiloto = (): ConfiguracionDocumentoTenant => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  branding: { logoUrl: null, colorPrimario: '#5edada', colorTexto: '#333333' },
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

const datosPresupuesto = (
  overrides: Partial<DatosDocumentoPresupuesto> = {},
): DatosDocumentoPresupuesto => ({
  numeroPresupuesto: '2026001',
  fecha: new Date('2026-07-13T00:00:00.000Z'),
  regimen: 'con_iva',
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
  fechaEvento: new Date('2026-09-20T00:00:00.000Z'),
  horario: '12:00',
  duracionHoras: 8,
  numPersonas: 14,
  extras: [],
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
// 3.1 — Fecha del evento "D de <mes> de AAAA" (con año, mes por idioma).
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — fecha del evento legible con año', () => {
  it('debe_formatear_la_fecha_como_D_de_mes_en_catalan_con_año_cuando_idioma_es_ca', () => {
    // Arrange
    const config = configPiloto();
    const datos = datosPresupuesto({
      fechaEvento: new Date('2026-09-20T00:00:00.000Z'),
      idioma: 'ca',
    });

    // Act
    const modelo = construirModeloDocumentoPresupuesto(config, datos);

    // Assert — campo nuevo `fechaEventoTexto`; mes catalán, con año, NO dd/mm/aaaa.
    expect(modelo.fechaEventoTexto).toBe('20 de setembre de 2026');
    expect(modelo.fechaEventoTexto).not.toBe('20/09/2026');
  });

  it('debe_formatear_la_fecha_como_D_de_mes_en_castellano_con_año_cuando_idioma_es_es', () => {
    const datos = datosPresupuesto({
      fechaEvento: new Date('2026-09-20T00:00:00.000Z'),
      idioma: 'es',
    });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.fechaEventoTexto).toBe('20 de septiembre de 2026');
  });

  it('debe_ser_determinista_en_UTC_sin_desplazar_el_dia_por_zona_horaria', () => {
    // Fecha a medianoche UTC: en TZ negativas un formateo naive caería al día anterior.
    const datos = datosPresupuesto({
      fechaEvento: new Date('2026-01-01T00:00:00.000Z'),
      idioma: 'ca',
    });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.fechaEventoTexto).toBe('1 de gener de 2026');
  });
});

// ===========================================================================
// 3.2 — Horario "De HH:MM a HH:MM (N <hores|horas>)" + cruce medianoche + fallback.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — horario con rango de inicio a fin', () => {
  it('debe_mostrar_rango_De_12_00_a_18_00_8_hores_en_ca', () => {
    const datos = datosPresupuesto({ horario: '12:00', duracionHoras: 8, idioma: 'ca' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    // Campo nuevo `horarioTexto`. Fin = 12:00 + 8h = 20:00... verificamos abajo el mod.
    expect(modelo.horarioTexto).toBe('De 12:00 a 20:00 (8 hores)');
  });

  it('debe_usar_la_palabra_horas_en_castellano', () => {
    const datos = datosPresupuesto({ horario: '12:00', duracionHoras: 8, idioma: 'es' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.horarioTexto).toBe('De 12:00 a 20:00 (8 horas)');
  });

  it('debe_conservar_siempre_los_minutos_con_cero_padding_HH_MM', () => {
    // Inicio con minutos != 00 → fin también con minutos correctos y padding.
    const datos = datosPresupuesto({ horario: '09:30', duracionHoras: 4, idioma: 'ca' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    // 09:30 + 4h = 13:30
    expect(modelo.horarioTexto).toBe('De 09:30 a 13:30 (4 hores)');
  });

  it('debe_calcular_la_hora_de_fin_cruzando_medianoche_con_mod_1440', () => {
    // 22:00 + 4h = 26:00 → (22*60 + 240) mod 1440 = 120 min = 02:00.
    const datos = datosPresupuesto({ horario: '22:00', duracionHoras: 4, idioma: 'ca' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.horarioTexto).toBe('De 22:00 a 02:00 (4 hores)');
  });

  it('debe_caer_al_fallback_solo_duracion_cuando_horario_es_null_en_ca', () => {
    const datos = datosPresupuesto({ horario: null, duracionHoras: 8, idioma: 'ca' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.horarioTexto).toBe('(8 hores)');
    expect(modelo.horarioTexto).not.toContain('De ');
  });

  it('debe_caer_al_fallback_solo_duracion_cuando_horario_es_null_en_es', () => {
    const datos = datosPresupuesto({ horario: null, duracionHoras: 12, idioma: 'es' });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.horarioTexto).toBe('(12 horas)');
  });
});

// ===========================================================================
// 3.5 — Etiquetas fijas resueltas por idioma (varias representativas) + default es.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — etiquetas fijas por idioma', () => {
  it('debe_resolver_las_etiquetas_fijas_en_catalan', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'ca' }),
    );

    // Campo nuevo `etiquetas`: objeto con las etiquetas ya traducidas.
    expect(modelo.etiquetas.titulo).toBe('PRESSUPOST');
    expect(modelo.etiquetas.numeroDoc).toBe('Pressupost');
    expect(modelo.etiquetas.fecha).toBe('Data');
    expect(modelo.etiquetas.datosCliente).toBe('Dades client');
    expect(modelo.etiquetas.concepto).toBe('CONCEPTE');
    expect(modelo.etiquetas.precio).toBe('PREU');
    expect(modelo.etiquetas.personas).toBe('persones');
    expect(modelo.etiquetas.validesa).toBe('Validesa');
    expect(modelo.etiquetas.baseImponible).toBe('Base imposable');
    expect(modelo.etiquetas.total).toBe('Total');
    expect(modelo.etiquetas.condiciones).toBe('Condicions');
    expect(modelo.etiquetas.pagamentAnticipat).toBe('Pagament anticipat');
    expect(modelo.etiquetas.fianza).toBe('Fiança');
  });

  it('debe_resolver_las_etiquetas_fijas_en_castellano', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'es' }),
    );

    expect(modelo.etiquetas.titulo).toBe('PRESUPUESTO');
    expect(modelo.etiquetas.numeroDoc).toBe('Presupuesto');
    expect(modelo.etiquetas.fecha).toBe('Fecha');
    expect(modelo.etiquetas.datosCliente).toBe('Datos del cliente');
    expect(modelo.etiquetas.concepto).toBe('CONCEPTO');
    expect(modelo.etiquetas.precio).toBe('PRECIO');
    expect(modelo.etiquetas.personas).toBe('personas');
    expect(modelo.etiquetas.validesa).toBe('Validez');
    expect(modelo.etiquetas.baseImponible).toBe('Base imponible');
    expect(modelo.etiquetas.total).toBe('Total');
    expect(modelo.etiquetas.condiciones).toBe('Condiciones');
    expect(modelo.etiquetas.pagamentAnticipat).toBe('Pago anticipado');
    expect(modelo.etiquetas.fianza).toBe('Fianza');
  });

  it('debe_caer_al_default_castellano_cuando_el_idioma_no_es_reconocible', () => {
    // Idioma fuera del union (dato de entrada degradado): default 'es'.
    const datos = datosPresupuesto({
      idioma: 'de' as unknown as DatosDocumentoPresupuesto['idioma'],
    });

    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datos);

    expect(modelo.etiquetas.titulo).toBe('PRESUPUESTO');
    expect(modelo.etiquetas.personas).toBe('personas');
  });
});

// ===========================================================================
// 3.6 — Textos libres del tenant elegidos por idioma + {nombreComercial} resuelto.
// ===========================================================================

describe('construirModeloDocumentoPresupuesto — textos libres bilingües por idioma', () => {
  it('debe_elegir_el_concepto_catalan_y_resolver_nombreComercial_cuando_idioma_ca', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'ca' }),
    );

    expect(modelo.conceptoPrincipal).toBe(
      "Gestió ús espai de Masia l'Encís per esdeveniment",
    );
    expect(modelo.conceptoPrincipal).not.toContain('{nombreComercial}');
  });

  it('debe_elegir_el_concepto_castellano_y_resolver_nombreComercial_cuando_idioma_es', () => {
    const modelo = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'es' }),
    );

    expect(modelo.conceptoPrincipal).toBe(
      "Gestión de uso del espacio de Masia l'Encís para evento",
    );
  });

  it('debe_elegir_la_validesa_y_el_pieLegal_del_idioma_del_cliente', () => {
    const modeloCa = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'ca' }),
    );
    const modeloEs = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'es' }),
    );

    expect(modeloCa.validesaTexto).toBe('10 DIES');
    expect(modeloEs.validesaTexto).toBe('10 DÍAS');
    expect(modeloCa.pieLegal).toBe(
      'Aquest document té una validesa de 10 dies des de la seva emissió.',
    );
    expect(modeloEs.pieLegal).toBe(
      'Este documento tiene una validez de 10 días desde su emisión.',
    );
  });

  it('debe_no_contener_nunca_la_palabra_lloguer_en_ninguno_de_los_dos_idiomas', () => {
    const modeloCa = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'ca' }),
    );
    const modeloEs = construirModeloDocumentoPresupuesto(
      configPiloto(),
      datosPresupuesto({ idioma: 'es' }),
    );

    expect(JSON.stringify(modeloCa).toLowerCase()).not.toContain('lloguer');
    expect(JSON.stringify(modeloEs).toLowerCase()).not.toContain('lloguer');
  });
});
