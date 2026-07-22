/**
 * TEST de LAYOUT (render react-pdf, kit FALSO de captura) del `DocumentoFacturaLayout`
 * fiel a la referencia `F2026029 Sergio Carrasco.pdf` — change `factura-pdf-fiel-referencia`,
 * fase TDD RED.
 *
 * Trazabilidad: spec-delta `documentos` — Requirement "Modelo de vista y renderizado de
 * factura (rebanada 6.3)" y "Fidelidad visual…"; escenarios:
 *   - "La factura no renderiza el pie legal de validez",
 *   - "La franja de totales de la factura muestra 'Import factura' sin validez",
 *   - "El pie bancario de la factura es fiel a la referencia",
 *   - "La factura de señal replica la identidad visual de su referencia".
 * design.md §D2 (concepto principal + subtítulo indentado), §D3 (BloqueTotales
 * parametrizado: "Import factura" + valor izquierda vacío), §D4 (factura sin pie legal),
 * §D5 (PieBancario sin beneficiario + línea oro `COLOR_ACENTO`).
 *
 * ESTRATEGIA (kit FALSO de captura, idéntica a los specs de layout vecinos
 * `documento-presupuesto-pie-bancario.layout.spec.ts` y
 * `documento-presupuesto-titulo-amarillo.layout.spec.ts`): las primitivas react-pdf se
 * inyectan por `kit` y se sustituyen por componentes que devuelven sus `children`. Se recorre
 * el árbol recogiendo TODO el texto (para aserciones de contenido) y, aparte, todos los
 * `backgroundColor` de estilo (para localizar la LÍNEA ORO `COLOR_ACENTO = #ffd978`). No usa
 * react-dom ni parsea un PDF real (la verificación visual pixel a pixel es de QA).
 *
 * FLAKINESS: este spec NO importa react-pdf real (usa kit falso), así que NO sufre la
 * flakiness ESM de las suites `pdf-*.real.adapter.spec.ts`. Aun así, para verificarlo en
 * AISLAMIENTO: `pnpm --filter @slotify/api test -- documento-factura-fiel-referencia`.
 *
 * RED esperado (por la razón correcta):
 *   - "Import factura" en la franja de totales FALLA hoy (BloqueTotales pinta
 *     `etiquetas.validesa` = "Validesa"/"Validez", no `etiquetas.importFactura`).
 *   - "no aparece Validesa/Validez" FALLA hoy (la etiqueta izquierda es la validez).
 *   - "no aparece el pie legal de validez" FALLA hoy (`DocumentoFacturaLayout` pinta
 *     `modelo.pieLegal`).
 *   - "el pie bancario no contiene 'Dades bancàries:'" FALLA hoy (PieBancario pinta el
 *     beneficiario con ese rótulo).
 *   - "hay una línea oro `#ffd978` antes del pie bancario" FALLA hoy (no existe).
 *   - "el subtítulo indentado aparece bajo el concepto" FALLA hoy (el modelo no expone
 *     `conceptoSubtitulo` y BloqueConceptoFactura no lo pinta).
 * GREEN es de `backend-developer`/`frontend-developer`.
 */
import { createElement, isValidElement, type ReactNode } from 'react';
import { DocumentoFacturaLayout } from '../componentes/DocumentoFacturaLayout';
import { COLOR_ACENTO } from '../estilos';
import {
  construirModeloDocumentoFactura,
  type DatosDocumentoFactura,
} from '../modelo-documento-factura';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirConfiguracionDocumentoPiloto } from '../../infrastructure/seed/configuracion-documento-piloto';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

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

/** Recorre el árbol invocando componentes-función y concatena TODO el texto. */
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

/** Recorre el árbol recogiendo los `backgroundColor` de cada nodo con estilo. */
const recogerBackgroundColors = (nodo: ReactNode): string[] => {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return [];
  if (typeof nodo === 'string' || typeof nodo === 'number') return [];
  if (Array.isArray(nodo)) return nodo.flatMap(recogerBackgroundColors);
  if (!isValidElement(nodo)) return [];

  const { type, props } = nodo as {
    type: unknown;
    props: { children?: ReactNode; style?: unknown };
  };
  const resultados: string[] = [];
  const estilo = aplanarEstilo(props?.style);
  if (typeof estilo.backgroundColor === 'string') resultados.push(estilo.backgroundColor);

  if (typeof type === 'function') {
    resultados.push(
      ...recogerBackgroundColors((type as (p: unknown) => ReactNode)(props)),
    );
  } else {
    resultados.push(...recogerBackgroundColors(props?.children));
  }
  return resultados;
};

// ---------------------------------------------------------------------------
// Fixtures: config REAL del piloto + factura de señal CON IVA (ivaPorcentaje 21).
// ---------------------------------------------------------------------------

const cliente = (): DatosDocumentoFactura['cliente'] => ({
  nombre: 'Sergio',
  apellidos: 'Carrasco',
  dniNif: '47123456Z',
  direccion: 'Carrer Major, 12',
  codigoPostal: '08720',
  poblacion: 'Vilafranca del Penedès',
  provincia: 'Barcelona',
});

const datosSenalConIva = (
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

const textoDeFacturaSenal = (idioma: 'ca' | 'es' = 'ca'): string => {
  const modelo = construirModeloDocumentoFactura({
    config: construirConfiguracionDocumentoPiloto(TENANT_ID),
    datos: datosSenalConIva({ idioma }),
  });
  const elemento = createElement(DocumentoFacturaLayout, { kit: kitDeCaptura(), modelo });
  return recogerTexto(elemento);
};

// ===========================================================================
// D4 — La factura de señal NO renderiza el pie legal de validez.
// ===========================================================================

describe('DocumentoFacturaLayout — la factura NO renderiza el pie legal de validez (D4)', () => {
  it('no_debe_contener_la_frase_de_validesa_10_dies_en_catalan', () => {
    const texto = textoDeFacturaSenal('ca');
    expect(texto).not.toContain('validesa de 10 dies');
  });

  it('no_debe_contener_la_frase_de_validez_10_dias_en_castellano', () => {
    const texto = textoDeFacturaSenal('es');
    expect(texto).not.toContain('validez de 10 días');
  });
});

// ===========================================================================
// D3 — Franja de totales: "Import factura" (etiqueta) sin fila de validez.
// ===========================================================================

describe('DocumentoFacturaLayout — franja de totales con "Import factura" y sin validez', () => {
  it('debe_mostrar_la_etiqueta_import_factura_en_la_franja_de_totales', () => {
    const texto = textoDeFacturaSenal('ca');
    expect(texto).toContain('Import factura');
  });

  it('no_debe_mostrar_la_etiqueta_validesa_en_la_factura', () => {
    const texto = textoDeFacturaSenal('ca');
    // La factura ya no pinta la fila de validez (esa etiqueta es del presupuesto).
    expect(texto).not.toContain('Validesa');
  });

  it('no_debe_mostrar_la_etiqueta_validez_en_la_factura_castellana', () => {
    const texto = textoDeFacturaSenal('es');
    expect(texto).toContain('Importe factura');
    expect(texto).not.toContain('Validez');
  });
});

// ===========================================================================
// D5 — Pie bancario fiel: sin "Dades bancàries:" (beneficiario) y con línea oro.
// ===========================================================================

describe('DocumentoFacturaLayout — pie bancario fiel a la referencia (sin beneficiario, con línea oro)', () => {
  it('no_debe_contener_el_rotulo_dades_bancaries_del_beneficiario', () => {
    const texto = textoDeFacturaSenal('ca');
    // La factura omite la línea "Dades bancàries: {beneficiario}".
    expect(texto).not.toContain('Dades bancàries:');
  });

  it('debe_seguir_mostrando_la_frase_de_formalizacion_la_de_transferencia_y_el_iban', () => {
    const texto = textoDeFacturaSenal('ca');
    // El resto del pie bancario se mantiene (solo se omite el beneficiario).
    expect(texto).toContain('Per formalitzar el pagament');
    expect(texto).toContain('transferència');
    expect(texto).toContain('ES30 0182 1683 4002 0172 9599');
  });

  it('debe_incluir_una_linea_oro_divisoria_color_ffd978_antes_del_pie', () => {
    const modelo = construirModeloDocumentoFactura({
      config: construirConfiguracionDocumentoPiloto(TENANT_ID),
      datos: datosSenalConIva({ idioma: 'ca' }),
    });
    const elemento = createElement(DocumentoFacturaLayout, {
      kit: kitDeCaptura(),
      modelo,
    });

    const backgrounds = recogerBackgroundColors(elemento);
    expect(COLOR_ACENTO).toBe('#ffd978');
    expect(backgrounds).toContain(COLOR_ACENTO);
  });
});

// ===========================================================================
// D1/D2 — Concepto principal + subtítulo indentado bajo él.
// ===========================================================================

describe('DocumentoFacturaLayout — concepto principal en negrita + subtítulo indentado debajo', () => {
  it('debe_pintar_el_concepto_principal_de_la_plantilla_del_tenant', () => {
    const texto = textoDeFacturaSenal('ca');
    expect(texto).toContain("Gestió ús espai de Masia l'Encís per esdeveniment");
  });

  it('debe_pintar_el_subtitulo_de_referencia_40_por_ciento_bajo_el_concepto', () => {
    const texto = textoDeFacturaSenal('ca');
    expect(texto).toContain(
      "*40% de l'import total anticipat del pressupost núm. P2026029",
    );
  });
});
