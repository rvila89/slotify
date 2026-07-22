/**
 * TEST del componente react-pdf `BloqueConceptoFactura` — nuevo prop `conceptoSubtitulo`
 * (change `factura-pdf-fiel-referencia`, épico #6 rebanada 6.3). Fase TDD RED.
 *
 * Trazabilidad: spec-delta `documentos` — Requirement "Componente BloqueConceptoFactura en la
 * capa de plantilla (rebanada 6.3)"; escenarios:
 *   - "BloqueConceptoFactura sin subtítulo ni extras renderiza solo el concepto",
 *   - "BloqueConceptoFactura con subtítulo renderiza la línea de referencia indentada",
 *   - "BloqueConceptoFactura con extras renderiza los sub-conceptos".
 * design.md §D2 (subtítulo indentado, NO negrita, bajo el concepto principal; ausente cuando
 * es null/vacío).
 *
 * FIRMA QUE FIJA ESTE TEST: `BloqueConceptoFacturaProps` gana `conceptoSubtitulo?: string |
 * null`. Cuando es truthy, el componente pinta una línea indentada NO negrita bajo el
 * concepto principal; cuando es null/ausente, NO la pinta (fianza y compatibilidad).
 *
 * ESTRATEGIA (kit FALSO de captura, como los layout specs vecinos): las primitivas react-pdf
 * se inyectan por `kit` y devuelven sus `children`. Se recogen los pares { texto, fontFamily }
 * de cada `<Text>` para (a) verificar presencia/ausencia del subtítulo y (b) que el subtítulo
 * NO usa `Helvetica-Bold` (no negrita) mientras que el concepto principal SÍ.
 *
 * RED esperado (por la razón correcta): hoy `BloqueConceptoFacturaProps` NO declara
 * `conceptoSubtitulo` y el componente no pinta ninguna línea de subtítulo → el assert
 * "contiene el subtítulo" FALLA. GREEN es de `frontend-developer`/`backend-developer`.
 */
import { createElement, isValidElement, type ReactNode } from 'react';
import { BloqueConceptoFactura } from '../componentes/BloqueConceptoFactura';
import { construirEstilos } from '../estilos';
import type { KitReactPdf } from '../kit-react-pdf';

const PasaHijos = ({ children }: { children?: ReactNode }): ReactNode => children ?? null;

const kitDeCaptura = (): KitReactPdf => ({
  Document: PasaHijos,
  Page: PasaHijos,
  View: PasaHijos,
  Text: PasaHijos,
  Image: PasaHijos,
  StyleSheet: { create: (estilos) => estilos },
});

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

/** Recoge, por cada `<Text>` con texto directo, el par { texto, fontFamily }. */
const recogerTextos = (
  nodo: ReactNode,
): Array<{ texto: string; fontFamily: string | undefined }> => {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return [];
  if (Array.isArray(nodo)) return nodo.flatMap(recogerTextos);
  if (!isValidElement(nodo)) return [];

  const { type, props } = nodo as {
    type: unknown;
    props: { children?: ReactNode; style?: unknown };
  };
  const resultados: Array<{ texto: string; fontFamily: string | undefined }> = [];
  const hijos = props?.children;
  if (typeof hijos === 'string' || typeof hijos === 'number') {
    const estilo = aplanarEstilo(props?.style);
    resultados.push({
      texto: String(hijos),
      fontFamily: estilo.fontFamily as string | undefined,
    });
  }
  if (typeof type === 'function') {
    resultados.push(...recogerTextos((type as (p: unknown) => ReactNode)(props)));
  } else {
    resultados.push(...recogerTextos(props?.children));
  }
  return resultados;
};

const estilos = construirEstilos(kitDeCaptura().StyleSheet);

const CONCEPTO = "Gestió ús espai de Masia l'Encís per esdeveniment";
const SUBTITULO = "*40% de l'import total anticipat del pressupost núm. P2026029";

const renderBloque = (props: {
  concepto: string;
  conceptoSubtitulo?: string | null;
  extras?: ReadonlyArray<{ descripcion: string; subtotal: string }>;
}) =>
  recogerTextos(
    createElement(BloqueConceptoFactura, {
      kit: kitDeCaptura(),
      estilos,
      colorPrimario: '#5edada',
      etiquetaConcepto: 'CONCEPTE',
      etiquetaPrecio: 'PREU',
      concepto: props.concepto,
      precioTotal: '1200.00',
      conceptoSubtitulo: props.conceptoSubtitulo,
      extras: props.extras,
    } as unknown as Parameters<typeof BloqueConceptoFactura>[0]),
  );

// ===========================================================================
// Sin subtítulo → solo concepto (comportamiento actual: fianza/compatibilidad).
// ===========================================================================

describe('BloqueConceptoFactura — sin subtítulo renderiza solo el concepto', () => {
  it('no_debe_pintar_ninguna_linea_de_subtitulo_cuando_conceptoSubtitulo_es_null', () => {
    const textos = renderBloque({ concepto: CONCEPTO, conceptoSubtitulo: null });
    const contenidos = textos.map((t) => t.texto);

    expect(contenidos).toContain(CONCEPTO);
    // No hay ninguna línea de referencia con asterisco/porcentaje.
    expect(contenidos.some((c) => c.includes('40%'))).toBe(false);
  });
});

// ===========================================================================
// Con subtítulo → línea indentada NO negrita bajo el concepto principal (negrita).
// ===========================================================================

describe('BloqueConceptoFactura — con subtítulo pinta la línea de referencia indentada no negrita', () => {
  it('debe_pintar_el_subtitulo_bajo_el_concepto', () => {
    const textos = renderBloque({ concepto: CONCEPTO, conceptoSubtitulo: SUBTITULO });
    const contenidos = textos.map((t) => t.texto);

    expect(contenidos).toContain(CONCEPTO);
    expect(contenidos).toContain(SUBTITULO);
  });

  it('debe_pintar_el_concepto_en_negrita_y_el_subtitulo_NO_en_negrita', () => {
    const textos = renderBloque({ concepto: CONCEPTO, conceptoSubtitulo: SUBTITULO });

    const principal = textos.find((t) => t.texto === CONCEPTO);
    const subtitulo = textos.find((t) => t.texto === SUBTITULO);

    expect(principal?.fontFamily).toBe('Helvetica-Bold');
    expect(subtitulo).toBeDefined();
    expect(subtitulo?.fontFamily).not.toBe('Helvetica-Bold');
  });
});

// ===========================================================================
// Con subtítulo + extras → concepto + subtítulo + cada extra con su subtotal.
// ===========================================================================

describe('BloqueConceptoFactura — con subtítulo y extras pinta todos los sub-conceptos', () => {
  it('debe_pintar_el_concepto_el_subtitulo_y_cada_extra_con_su_subtotal', () => {
    const textos = renderBloque({
      concepto: CONCEPTO,
      conceptoSubtitulo: SUBTITULO,
      extras: [{ descripcion: 'Neteja', subtotal: '100.00' }],
    });
    const contenidos = textos.map((t) => t.texto);

    expect(contenidos).toContain(CONCEPTO);
    expect(contenidos).toContain(SUBTITULO);
    expect(contenidos).toContain('Neteja');
    // Formato de importe con coma decimal (change factura-pdf-fiel-referencia §D7): el
    // subtotal del extra se pinta como una sola cadena "100,00 €", nunca con punto.
    expect(contenidos.some((c) => c.includes('100,00 €'))).toBe(true);
    expect(contenidos.some((c) => c.includes('100.00'))).toBe(false);
  });
});
