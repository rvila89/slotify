/**
 * "Kit" de primitivas de react-pdf inyectado en los componentes de la plantilla (épico
 * #6, 6.1b).
 *
 * `@react-pdf/renderer` es un paquete ESM puro sin build CommonJS. El backend compila a
 * CommonJS, así que react-pdf se carga UNA vez con `import()` nativo en el render y sus
 * primitivas (`Document`, `Page`, `View`, `Text`, `Image`, `StyleSheet`) se pasan a los
 * componentes como este `kit`. Así los `.tsx` NO importan react-pdf estáticamente y todo
 * el árbol permanece CommonJS; solo react-pdf cruza la frontera ESM. Reutilizable por la
 * factura (6.3).
 */
import type { ComponentType } from 'react';

/** Estilos react-pdf (objeto opaco de estilo por clave). */
export type EstilosReactPdf = Record<string, unknown>;

/** Primitivas de react-pdf que consumen los componentes de la plantilla. */
export interface KitReactPdf {
  Document: ComponentType<Record<string, unknown>>;
  Page: ComponentType<Record<string, unknown>>;
  View: ComponentType<Record<string, unknown>>;
  Text: ComponentType<Record<string, unknown>>;
  Image: ComponentType<Record<string, unknown>>;
  StyleSheet: { create: (estilos: EstilosReactPdf) => EstilosReactPdf };
}
