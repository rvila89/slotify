/**
 * TEST de LAYOUT: el bloque de concepto del presupuesto pinta TRES líneas legibles
 * (fecha del evento "D de mes de AAAA" / horario "De HH:MM a HH:MM (N hores)" /
 * "N persones") — change `pdf-presupuesto-horario-idioma`, fase TDD RED (tasks.md 3.1/3.2).
 *
 * Trazabilidad: spec-delta `presupuestos` — Scenario "El bloque de concepto muestra
 * fecha con año y rango horario"; spec-delta `documentos` — Requirement "Fecha y horario
 * legibles del evento en el bloque de concepto".
 *
 * ESTRATEGIA (kit FALSO de captura de texto): idéntica al spec vecino
 * `documento-presupuesto-pie-bancario.layout.spec.ts`: las primitivas react-pdf se
 * inyectan por `kit` y devuelven sus `children`; se recorre el árbol recogiendo TODO el
 * texto compuesto sin react-pdf real ni parsear un PDF.
 *
 * RED esperado (por la razón correcta): hoy `TablaConcepto` pinta la fecha como
 * `formatearFecha` "dd/mm/aaaa", `duracionTexto` "(N hores)" y "N persones" en catalán
 * fijo. Las aserciones de "20 de setembre de 2026", "De 12:00 a 20:00 (8 hores)" y de
 * los strings ya resueltos por el modelo FALLAN hasta que el modelo exponga
 * `fechaEventoTexto`/`horarioTexto`/`etiquetas.personas` y `TablaConcepto` los pinte.
 * Además hoy `DatosDocumentoPresupuesto` no tiene `idioma`/`horario` ni `textos` es
 * bilingüe → falla también por TS. GREEN es de backend/frontend-developer.
 */
import { createElement, isValidElement, type ReactNode } from 'react';
import { DocumentoLayout } from '../componentes/DocumentoLayout';
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
} from '../modelo-documento-presupuesto';
import type { KitReactPdf } from '../kit-react-pdf';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const PasaHijos = ({ children }: { children?: ReactNode }): ReactNode => children ?? null;

const kitDeCaptura = (): KitReactPdf => ({
  Document: PasaHijos,
  Page: PasaHijos,
  View: PasaHijos,
  Text: PasaHijos,
  Image: PasaHijos,
  StyleSheet: { create: (estilos) => estilos },
});

const recogerTexto = (nodo: ReactNode): string => {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return '';
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(recogerTexto).join(' ');
  if (isValidElement(nodo)) {
    const { type, props } = nodo as { type: unknown; props: { children?: ReactNode } };
    if (typeof type === 'function') {
      return recogerTexto((type as (p: unknown) => ReactNode)(props));
    }
    return recogerTexto(props?.children);
  }
  return '';
};

const textoRenderizado = (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuesto,
): string => {
  const modelo = construirModeloDocumentoPresupuesto(config, datos);
  return recogerTexto(createElement(DocumentoLayout, { kit: kitDeCaptura(), modelo }));
};

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

describe('DocumentoLayout — bloque de concepto con tres líneas legibles (ca)', () => {
  it('debe_pintar_la_fecha_del_evento_como_texto_con_año_no_dd_mm_aaaa', () => {
    const texto = textoRenderizado(configPiloto(), datosPresupuesto({ idioma: 'ca' }));

    expect(texto).toContain('20 de setembre de 2026');
    expect(texto).not.toContain('20/09/2026');
  });

  it('debe_pintar_el_rango_horario_De_HH_MM_a_HH_MM_N_hores', () => {
    const texto = textoRenderizado(configPiloto(), datosPresupuesto({ idioma: 'ca' }));

    expect(texto).toContain('De 12:00 a 20:00 (8 hores)');
  });

  it('debe_pintar_la_linea_de_personas_con_la_etiqueta_del_idioma', () => {
    const texto = textoRenderizado(configPiloto(), datosPresupuesto({ idioma: 'ca' }));

    expect(texto).toContain('14 persones');
  });

  it('debe_pintar_la_linea_de_horario_de_fallback_cuando_no_hay_horario', () => {
    const texto = textoRenderizado(
      configPiloto(),
      datosPresupuesto({ idioma: 'ca', horario: null }),
    );

    expect(texto).toContain('(8 hores)');
    expect(texto).not.toContain('De ');
  });
});

describe('DocumentoLayout — bloque de concepto en castellano', () => {
  it('debe_pintar_fecha_horario_y_personas_en_castellano', () => {
    const texto = textoRenderizado(configPiloto(), datosPresupuesto({ idioma: 'es' }));

    expect(texto).toContain('20 de septiembre de 2026');
    expect(texto).toContain('De 12:00 a 20:00 (8 horas)');
    expect(texto).toContain('14 personas');
  });
});
