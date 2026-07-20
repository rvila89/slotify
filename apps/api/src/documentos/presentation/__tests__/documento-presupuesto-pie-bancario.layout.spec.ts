/**
 * TEST del REFINAMIENTO "el pieLegal se conserva en SIN IVA, desacoplado del bloque
 * bancario" (épico #6, fix `documentos-sin-iva-omite-pie-bancario`, decisión del gate
 * final) — fase TDD RED.
 *
 * DECISIÓN DE DISEÑO (fijada): el `pieLegal` ("Aquest document té una validesa de 10
 * dies…") debe pintarse SIEMPRE (CON y SIN IVA), desacoplado de los DATOS bancarios.
 *   - `PieBancario.tsx` deja de recibir/pintar `pieLegal` (solo IBAN/beneficiario/
 *     concepte) y sigue condicionado a `modelo.pieBancario.mostrar`.
 *   - `DocumentoLayout.tsx` pinta el `pieLegal` como elemento PROPIO SIEMPRE (independiente
 *     del bloque bancario). CON IVA: bloque bancario + pieLegal; SIN IVA: solo pieLegal.
 *
 * POR QUÉ ESTE SPEC ES DE LAYOUT (y no de modelo, como los vecinos): la composición vive
 * en `DocumentoLayout` —el MODELO ya expone `pieLegal` en ambas variantes (lo asere el
 * spec vecino de 6.2)—. Lo que este refinamiento cambia es DÓNDE se pinta el pieLegal, y
 * eso solo se observa recorriendo el árbol que compone el layout.
 *
 * ESTRATEGIA (kit FALSO de captura): `DocumentoLayout` recibe las primitivas react-pdf
 * inyectadas por `kit` (nunca las importa; ver `kit-react-pdf.ts`). Se le pasa un kit de
 * test cuyos `Document/Page/View/Text/Image` son componentes que devuelven sus `children`
 * (elementos React normales, sin react-pdf real) y cuyo `StyleSheet.create` devuelve el
 * objeto tal cual. Renderizado el elemento a un árbol de React, se recorre recogiendo TODO
 * el texto: así se inspecciona el contenido compuesto SIN react-pdf ni parsear un PDF.
 *
 * RED esperado (por la razón correcta): hoy el `pieLegal` se pinta DENTRO de `PieBancario`,
 * que en SIN IVA NO se compone (`modelo.pieBancario.mostrar === false`). Por tanto la
 * aserción "SIN IVA contiene el pieLegal" FALLA (el pieLegal desaparece con el bloque
 * bancario). El resto (SIN IVA no contiene IBAN/"Dades bancàries"; CON IVA contiene ambos +
 * pieLegal) ya pasa hoy → aisla el fallo al desacoplamiento pendiente. GREEN es de
 * `frontend-developer`/`backend-developer` (mover el pieLegal de PieBancario al layout).
 */
import { createElement, isValidElement, type ReactNode } from 'react';
import { DocumentoLayout } from '../componentes/DocumentoLayout';
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
  type RegimenDocumento,
} from '../modelo-documento-presupuesto';
import type { KitReactPdf } from '../kit-react-pdf';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const CON_IVA: RegimenDocumento = 'con_iva';
const SIN_IVA: RegimenDocumento = 'sin_iva';

// Marcadores del pie bancario del tenant piloto (Excel real). El IBAN y el rótulo "Dades
// bancàries" son EXCLUSIVOS del bloque bancario → sirven de marcador de ausencia SIN IVA.
const IBAN_PILOTO = 'ES30 0182 1683 4002 0172 9599';
const ROTULO_DADES_BANCARIES = 'Dades bancàries';
const PIE_LEGAL_PILOTO = 'Aquest document té una validesa de 10 dies des de la seva emissió.';

// ---------------------------------------------------------------------------
// Kit FALSO de captura: cada primitiva react-pdf se sustituye por un componente que
// devuelve sus `children` (árbol React estándar, sin react-pdf real). `StyleSheet.create`
// devuelve el objeto tal cual (los estilos son opacos y no afectan al texto). Tipado según
// `KitReactPdf` (kit-react-pdf.ts).
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

/**
 * Recorre un árbol de elementos React recogiendo TODAS las cadenas de texto (los nodos
 * `string`/`number` que serían el texto renderizado). No usa react-dom (no está instalado):
 * como las primitivas del kit falso devuelven sus `children`, invocar cada componente-función
 * y descender por `props.children` reconstruye el texto sin un renderer real.
 */
const recogerTexto = (nodo: ReactNode): string => {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return '';
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(recogerTexto).join(' ');
  if (isValidElement(nodo)) {
    const { type, props } = nodo as {
      type: unknown;
      props: { children?: ReactNode };
    };
    // Componente-función (primitiva del kit o los componentes .tsx de la plantilla): se
    // invoca para obtener su salida y se desciende por ella.
    if (typeof type === 'function') {
      const salida = (type as (p: unknown) => ReactNode)(props);
      return recogerTexto(salida);
    }
    // Cualquier otro elemento: descender por children.
    return recogerTexto(props?.children);
  }
  return '';
};

const textoRenderizado = (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuesto,
): string => {
  const modelo = construirModeloDocumentoPresupuesto(config, datos);
  const elemento = createElement(DocumentoLayout, { kit: kitDeCaptura(), modelo });
  return recogerTexto(elemento);
};

// ---------------------------------------------------------------------------
// Fixtures: config del tenant piloto + datos CON/SIN IVA. Idénticos a los specs vecinos
// (6.1b / 6.2 / pie-bancario) para reutilizar configPiloto + datosConIva/datosSinIva.
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
    beneficiarioTransferencia: 'Canoliart, SL',
    conceptoTransferencia: "Masia l'Encís",
  },
  textos: {
    plantillaConceptoFiscal: {
      ca: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
      es: 'Gestión del uso del espacio de {nombreComercial} para evento',
    },
    validesaTexto: { ca: '10 DIES', es: '10 DÍAS' },
    pieLegal: { ca: PIE_LEGAL_PILOTO, es: PIE_LEGAL_PILOTO },
  },
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [],
  },
});

const datosConIva = (
  overrides: Partial<DatosDocumentoPresupuesto> = {},
): DatosDocumentoPresupuesto => ({
  numeroPresupuesto: '2026001',
  fecha: new Date('2026-07-13T00:00:00.000Z'),
  regimen: CON_IVA,
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
// SIN IVA: el pieLegal SE CONSERVA (elemento propio del layout), pero SIN el bloque
// bancario (ni IBAN ni el rótulo "Dades bancàries").
// ===========================================================================

describe('DocumentoLayout SIN IVA — conserva el pieLegal desacoplado del bloque bancario', () => {
  it('debe_conservar_el_pie_legal_en_la_variante_sin_iva', () => {
    // Arrange
    const config = configPiloto();
    const datos = datosSinIva();

    // Act
    const texto = textoRenderizado(config, datos);

    // Assert — el pieLegal se pinta SIEMPRE (aunque SIN IVA omita el bloque bancario).
    // RED HOY: el pieLegal vive dentro de <PieBancario>, que en SIN IVA no se compone.
    expect(texto).toContain(PIE_LEGAL_PILOTO);
  });

  it('debe_omitir_los_datos_bancarios_iban_y_rotulo_en_la_variante_sin_iva', () => {
    const texto = textoRenderizado(configPiloto(), datosSinIva());

    // El bloque bancario SÍ se omite en SIN IVA (comportamiento ya vigente del fix base).
    expect(texto).not.toContain(IBAN_PILOTO);
    expect(texto).not.toContain(ROTULO_DADES_BANCARIES);
  });
});

// ===========================================================================
// CON IVA (no-regresión): el layout pinta TANTO el bloque bancario (IBAN + "Dades
// bancàries") COMO el pieLegal.
// ===========================================================================

describe('DocumentoLayout CON IVA — pinta bloque bancario y pieLegal (no regresión)', () => {
  it('debe_pintar_iban_rotulo_bancario_y_pie_legal_en_la_variante_con_iva', () => {
    const texto = textoRenderizado(configPiloto(), datosConIva());

    expect(texto).toContain(IBAN_PILOTO);
    expect(texto).toContain(ROTULO_DADES_BANCARIES);
    expect(texto).toContain(PIE_LEGAL_PILOTO);
  });
});
