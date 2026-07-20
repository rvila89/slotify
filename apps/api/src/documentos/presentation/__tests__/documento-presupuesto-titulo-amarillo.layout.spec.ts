/**
 * TEST de LAYOUT: el título del PRESUPUESTO se pinta en AMARILLO (`COLOR_ACENTO`
 * `#ffd978`), no en el turquesa `colorPrimario`; la FACTURA conserva el turquesa
 * (no regresión) — change `pdf-presupuesto-horario-idioma`, fase TDD RED (tasks.md 3.4).
 *
 * Trazabilidad: spec-delta `documentos` — Requirement "Fidelidad visual…" (título del
 * PRESUPUESTO en amarillo `COLOR_ACENTO`; la FACTURA en turquesa); design.md D4
 * (el color del título es decisión del LAYOUT: `DocumentoLayout` pasa `COLOR_ACENTO`,
 * `DocumentoFacturaLayout` pasa `colorPrimario`).
 *
 * ESTRATEGIA (kit FALSO de captura de estilos): como en el spec vecino
 * `documento-presupuesto-pie-bancario.layout.spec.ts`, las primitivas react-pdf se
 * inyectan por `kit` y se sustituyen por componentes que devuelven sus `children`. Aquí,
 * además del texto, se RECOGE el `style` de cada `<Text>` para localizar el nodo cuyo
 * texto es el título y comprobar su color resuelto. El color del título se pasa como
 * `[estilos.tituloDocumento, { color: <X> }]` en `BloqueTitulo`, así que se busca el
 * objeto de estilo con clave `color`.
 *
 * RED esperado (por la razón correcta): hoy `DocumentoLayout` pinta el título con
 * `colorPrimario = modelo.cabecera.colorPrimario` (turquesa `#5edada`). La aserción
 * "el color del título del presupuesto es `#ffd978`" FALLA. La aserción de la factura
 * (turquesa) YA pasa hoy → aisla el fallo al cambio pendiente del layout del presupuesto.
 * GREEN es de `frontend-developer`/`backend-developer`.
 */
import { createElement, isValidElement, type ReactNode } from 'react';
import { DocumentoLayout } from '../componentes/DocumentoLayout';
import { DocumentoFacturaLayout } from '../componentes/DocumentoFacturaLayout';
import { COLOR_ACENTO } from '../estilos';
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
} from '../modelo-documento-presupuesto';
import type { KitReactPdf } from '../kit-react-pdf';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const TURQUESA = '#5edada';

// ---------------------------------------------------------------------------
// Kit FALSO: primitivas que devuelven sus children; StyleSheet.create identidad.
// ---------------------------------------------------------------------------

const PasaHijos = ({ children }: { children?: ReactNode }): ReactNode => children ?? null;

const kitDeCaptura = (): KitReactPdf => ({
  Document: PasaHijos,
  Page: PasaHijos,
  View: PasaHijos,
  Text: PasaHijos,
  Image: PasaHijos,
  StyleSheet: { create: (estilos) => estilos },
});

/** Aplana un `style` react-pdf (objeto o array de objetos) a un único objeto. */
const aplanarEstilo = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...aplanarEstilo(s) }),
      {},
    );
  }
  if (style && typeof style === 'object') return style as Record<string, unknown>;
  return {};
};

/**
 * Recorre el árbol invocando los componentes-función (como el spec vecino) y devuelve,
 * para cada nodo `Text` cuyo texto directo sea un string/number, el par { texto, color }.
 */
const recogerTextosConColor = (
  nodo: ReactNode,
): Array<{ texto: string; color: string | undefined }> => {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return [];
  if (Array.isArray(nodo)) return nodo.flatMap(recogerTextosConColor);
  if (!isValidElement(nodo)) return [];

  const { type, props } = nodo as {
    type: unknown;
    props: { children?: ReactNode; style?: unknown };
  };

  const resultados: Array<{ texto: string; color: string | undefined }> = [];

  // Nodo con texto directo string/number: capturar su texto + color del estilo.
  const hijos = props?.children;
  const textoDirecto =
    typeof hijos === 'string' || typeof hijos === 'number' ? String(hijos) : null;
  if (textoDirecto !== null) {
    const estilo = aplanarEstilo(props?.style);
    resultados.push({ texto: textoDirecto, color: estilo.color as string | undefined });
  }

  // Descender: si es componente-función lo invocamos; si no, por children.
  if (typeof type === 'function') {
    const salida = (type as (p: unknown) => ReactNode)(props);
    resultados.push(...recogerTextosConColor(salida));
  } else {
    resultados.push(...recogerTextosConColor(props?.children));
  }
  return resultados;
};

const colorDelTitulo = (nodos: Array<{ texto: string; color: string | undefined }>, titulo: string) =>
  nodos.find((n) => n.texto === titulo)?.color;

// ---------------------------------------------------------------------------
// Fixtures: config del piloto con TEXTOS BILINGÜES + branding turquesa.
// ---------------------------------------------------------------------------

const configPiloto = (): ConfiguracionDocumentoTenant => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  branding: { logoUrl: null, colorPrimario: TURQUESA, colorTexto: '#333333' },
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

const datosPresupuesto = (): DatosDocumentoPresupuesto => ({
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
});

// ===========================================================================
// El título del PRESUPUESTO es amarillo (COLOR_ACENTO), NO turquesa.
// ===========================================================================

describe('DocumentoLayout — título del presupuesto en amarillo COLOR_ACENTO', () => {
  it('debe_pintar_el_titulo_PRESSUPOST_en_amarillo_ffd978', () => {
    // Arrange
    const modelo = construirModeloDocumentoPresupuesto(configPiloto(), datosPresupuesto());
    const elemento = createElement(DocumentoLayout, { kit: kitDeCaptura(), modelo });

    // Act
    const nodos = recogerTextosConColor(elemento);
    // El título ya viene resuelto por idioma en el modelo; en ca es "PRESSUPOST".
    const color = colorDelTitulo(nodos, modelo.etiquetas.titulo);

    // Assert — RED HOY: el título usa `colorPrimario` (turquesa), no COLOR_ACENTO.
    expect(COLOR_ACENTO).toBe('#ffd978');
    expect(color).toBe(COLOR_ACENTO);
    expect(color).not.toBe(TURQUESA);
  });
});

// ===========================================================================
// La FACTURA conserva el título turquesa (no regresión).
// ===========================================================================

describe('DocumentoFacturaLayout — título de la factura en turquesa (no regresión)', () => {
  it('debe_pintar_el_titulo_de_la_factura_en_turquesa_colorPrimario', () => {
    // Modelo mínimo de factura compatible con DocumentoFacturaLayout.
    const modeloFactura = {
      tipo: 'senal' as const,
      numeroFactura: 'F2026001',
      fechaEmision: new Date('2026-07-13T00:00:00.000Z'),
      cabecera: {
        soloTexto: true,
        mostrarIdentidadFiscal: true,
        logoUrl: null,
        colorPrimario: TURQUESA,
        colorTexto: '#333333',
        razonSocialFiscal: 'Canoliart, SL',
        nombreComercial: "Masia l'Encís",
        nif: 'B10874287',
        direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
        web: 'www.masialencis.com',
        email: 'info@masialencis.com',
      },
      cliente: {
        nombre: 'Anna',
        apellidos: 'Puig Soler',
        dniNif: '47123456Z',
        direccion: 'Carrer Major, 12',
        codigoPostal: '08720',
        poblacion: 'Vilafranca del Penedès',
        provincia: 'Barcelona',
      },
      concepto: 'Bestreta 40%',
      extras: [],
      totales: {
        mostrarDesgloseIva: true,
        baseImponible: '400.00',
        ivaPorcentaje: '21.00',
        ivaImporte: '84.00',
        total: '484.00',
      },
      pieBancario: {
        mostrar: true,
        iban: 'ES30 0182 1683 4002 0172 9599',
        beneficiario: 'Canoliart, SL',
        concepto: "Masia l'Encís",
      },
      pieLegal: '',
    };

    const elemento = createElement(DocumentoFacturaLayout, {
      kit: kitDeCaptura(),
      // El shape del modelo de factura vive en `modelo-documento-factura`; casteamos
      // al tipo esperado sin importarlo (solo verificamos el COLOR del título aquí).
      modelo: modeloFactura as unknown as Parameters<typeof DocumentoFacturaLayout>[0]['modelo'],
    });

    const nodos = recogerTextosConColor(elemento);
    const color = colorDelTitulo(nodos, 'FACTURA');

    expect(color).toBe(TURQUESA);
    expect(color).not.toBe(COLOR_ACENTO);
  });
});
