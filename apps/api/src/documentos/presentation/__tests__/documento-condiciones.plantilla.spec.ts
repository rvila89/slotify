/**
 * TESTS de la CAPA DE PLANTILLA del documento de "Condicions particulars" react-pdf
 * (épico #6, rebanada 6.4a `documentos-condiciones-particulares-pdf`) — fase TDD RED.
 * tasks.md Fase 2: 2.4.
 *
 * Trazabilidad: design.md §"Plantilla react-pdf (ubicación y componentes)". El
 * documento es LEGAL, largo e IDÉNTICO por tenant: bloque de firma EN BLANCO (sin
 * datos de reserva). Las etiquetas del bloque de firma (NOM I COGNOMS CLIENT /
 * SIGNATURA CLIENT / DNI / DATA ESDEVENIMENT) son LAYOUT FIJO (no contenido de
 * negocio), igual que las etiquetas de columnas del presupuesto de 6.1b.
 *
 * ESTRATEGIA (idéntica a 6.1b, ver `documento-presupuesto.plantilla.spec.ts`):
 *   (A) FUNCIÓN PURA `construirModeloDocumentoCondiciones(config)` que proyecta el
 *       "modelo de vista": título del documento, títulos+cuerpos de las secciones y
 *       las etiquetas del bloque de firma (en blanco). El grueso de las aserciones
 *       de CONTENIDO recae aquí — determinista, sin react-pdf.
 *   (B) TEST LIGERO de que `renderizarDocumentoCondicionesABytes(config)` produce un
 *       `Uint8Array` no vacío que empieza por la firma `%PDF`. NO se inspecciona el
 *       texto del binario; la verificación VISUAL real es del paso de integración
 *       (sesión principal). Este test invoca el RENDER REAL react-pdf → requiere
 *       `NODE_OPTIONS=--experimental-vm-modules` (ya en el script `test`).
 *
 * RED: aún NO existen `documentos/presentation/modelo-documento-condiciones.ts` ni
 * `documentos/presentation/documento-condiciones.render.ts`, ni el bloque
 * `condiciones` del VO. Los imports fallan (TS2307) → batería en ROJO por AUSENCIA
 * DE IMPLEMENTACIÓN. GREEN es de `backend-developer` (incluye los `.tsx` de la
 * plantilla).
 */
import {
  construirModeloDocumentoCondiciones,
  type ModeloDocumentoCondiciones,
} from '../modelo-documento-condiciones';
import { renderizarDocumentoCondicionesABytes } from '../documento-condiciones.render';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto con el bloque `condiciones` (2 secciones) +
// un segundo tenant con datos DISTINTOS (para "no hardcodea negocio").
// ---------------------------------------------------------------------------

const base = (): Omit<ConfiguracionDocumentoTenant, 'condiciones'> => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  branding: { logoUrl: null, colorPrimario: '#1A1A1A', colorTexto: '#333333' },
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
    pieLegal: { ca: 'Validesa 10 dies.', es: 'Validez 10 días.' },
  },
});

const configPiloto = (): ConfiguracionDocumentoTenant => ({
  ...base(),
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [
      {
        titulo: { ca: 'Reserva i pagament', es: 'Reserva y pago' },
        cuerpo: {
          ca: 'La reserva es formalitza amb la senyal.',
          es: 'La reserva se formaliza con la señal.',
        },
      },
      {
        titulo: { ca: 'Fiança', es: 'Fianza' },
        cuerpo: {
          ca: 'Es requereix una fiança abans de l’esdeveniment.',
          es: 'Se requiere una fianza antes del evento.',
        },
      },
    ],
  },
});

const configOtroTenant = (): ConfiguracionDocumentoTenant => ({
  ...base(),
  tenantId: '00000000-0000-0000-0000-0000000000ff',
  condiciones: {
    titulo: { ca: 'Condiciones Generales', es: 'Condiciones Generales' },
    secciones: [
      {
        titulo: { ca: 'Depósito', es: 'Depósito' },
        cuerpo: { ca: 'Se exige un depósito.', es: 'Se exige un depósito.' },
      },
    ],
  },
});

const configSinSecciones = (): ConfiguracionDocumentoTenant => ({
  ...base(),
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [],
  },
});

// ===========================================================================
// 2.4 (A) — Modelo de vista: título + secciones + etiquetas de firma (en blanco).
// ===========================================================================

describe('construirModeloDocumentoCondiciones — título y secciones del tenant (2.4)', () => {
  it('debe_tomar_el_titulo_del_documento_de_la_config_del_tenant', () => {
    // Act
    const modelo: ModeloDocumentoCondiciones = construirModeloDocumentoCondiciones(
      configPiloto(),
    );

    // Assert
    expect(modelo.titulo).toBe('Condicions Particulars');
  });

  it('debe_proyectar_cada_seccion_con_su_titulo_y_cuerpo_en_orden', () => {
    const modelo = construirModeloDocumentoCondiciones(configPiloto());

    expect(modelo.secciones).toEqual([
      { titulo: 'Reserva i pagament', cuerpo: 'La reserva es formalitza amb la senyal.' },
      { titulo: 'Fiança', cuerpo: 'Es requereix una fiança abans de l’esdeveniment.' },
    ]);
  });

  it('debe_reflejar_datos_distintos_para_tenants_distintos_sin_valores_compartidos', () => {
    // Escenario "La plantilla no hardcodea contenido de negocio".
    const modeloA = construirModeloDocumentoCondiciones(configPiloto());
    const modeloB = construirModeloDocumentoCondiciones(configOtroTenant());

    expect(modeloA.titulo).not.toBe(modeloB.titulo);
    expect(modeloB.titulo).toBe('Condiciones Generales');
    expect(modeloB.secciones[0].titulo).toBe('Depósito');
  });
});

describe('construirModeloDocumentoCondiciones — bloque de firma en blanco (2.4)', () => {
  it('debe_exponer_las_cuatro_etiquetas_de_firma_como_layout_fijo', () => {
    const modelo = construirModeloDocumentoCondiciones(configPiloto());

    // Etiquetas fijas del layout (no dependen de la config ni de la reserva).
    expect(modelo.firma.etiquetas).toEqual([
      'NOM I COGNOMS CLIENT',
      'SIGNATURA CLIENT',
      'DNI',
      'DATA ESDEVENIMENT',
    ]);
  });

  it('no_debe_incluir_ningun_dato_de_reserva_en_el_bloque_de_firma', () => {
    // El documento es idéntico por tenant: firma EN BLANCO, sin valores de reserva.
    const modelo = construirModeloDocumentoCondiciones(configPiloto());

    const firmaSerializada = JSON.stringify(modelo.firma);
    expect(firmaSerializada).not.toMatch(/\d{8}[A-Z]/); // sin DNI concreto
    expect(firmaSerializada).not.toContain('2027'); // sin fecha de evento concreta
  });

  it('debe_proyectar_un_titulo_y_las_etiquetas_de_firma_aunque_no_haya_secciones', () => {
    // D3: config presente con 0 secciones → el modelo sigue teniendo título + firma.
    const modelo = construirModeloDocumentoCondiciones(configSinSecciones());

    expect(modelo.titulo).toBe('Condicions Particulars');
    expect(modelo.secciones).toEqual([]);
    expect(modelo.firma.etiquetas).toHaveLength(4);
  });
});

// ===========================================================================
// 2.4 (B) — Render ligero: produce bytes de PDF (firma %PDF), sin inspeccionar
//            el texto del binario. RENDER REAL react-pdf (ESM).
// ===========================================================================

describe('renderizarDocumentoCondicionesABytes — produce un PDF real (2.4)', () => {
  it('debe_devolver_bytes_no_vacios_que_empiezan_por_la_firma_%PDF', async () => {
    // Act
    const bytes = await renderizarDocumentoCondicionesABytes(configPiloto());

    // Assert — bytes no vacíos y firma de PDF (%PDF = 0x25 0x50 0x44 0x46).
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });

  it('debe_renderizar_sin_error_cuando_no_hay_secciones', async () => {
    // D3: 0 secciones no rompe el render (cabecera + título + firma).
    const bytes = await renderizarDocumentoCondicionesABytes(configSinSecciones());

    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });
});
