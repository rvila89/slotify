/**
 * Render del documento de presupuesto a BYTES de PDF (épico #6, 6.1b) — capa de
 * presentación de `documentos`.
 *
 * `renderizarDocumentoPresupuestoABytes(config, datos)` construye el modelo de vista
 * (`construirModeloDocumentoPresupuesto`), compone `DocumentoLayout` inyectándole las
 * primitivas de react-pdf y delega en `renderToBuffer`. Devuelve un `Uint8Array` que
 * empieza por la firma `%PDF`. Esta firma `(config, datos) => Promise<Uint8Array>` es la
 * que inyecta el adaptador real de PDF de `presupuestos`.
 *
 * INTEROP ESM: `@react-pdf/renderer` es ESM puro (sin build CommonJS); este módulo compila
 * a CommonJS (NestJS). Se carga con `import()` NATIVO a través de un `Function` para que
 * TypeScript NO lo transpile a `require` (que rompería el ESM). En runtime requiere el
 * loader ESM de Node (`--experimental-vm-modules` bajo Jest; nativo en Node en producción).
 * Los componentes `.tsx` NO importan react-pdf: reciben sus primitivas (`kit`) desde aquí.
 */
import { createElement } from 'react';
import {
  construirModeloDocumentoPresupuesto,
  type DatosDocumentoPresupuesto,
} from './modelo-documento-presupuesto';
import { DocumentoLayout } from './componentes/DocumentoLayout';
import type { KitReactPdf } from './kit-react-pdf';
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';

/** Módulo react-pdf cargado dinámicamente (subconjunto que usamos). */
interface ModuloReactPdf extends KitReactPdf {
  renderToBuffer: (documento: unknown) => Promise<Buffer>;
}

/** Import dinámico NATIVO (no transpilado a `require` por TypeScript). */
const importarNativo = (especificador: string): Promise<unknown> =>
  (Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(especificador);

export const renderizarDocumentoPresupuestoABytes = async (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuesto,
): Promise<Uint8Array> => {
  const modelo = construirModeloDocumentoPresupuesto(config, datos);
  const reactPdf = (await importarNativo('@react-pdf/renderer')) as ModuloReactPdf;
  const kit: KitReactPdf = {
    Document: reactPdf.Document,
    Page: reactPdf.Page,
    View: reactPdf.View,
    Text: reactPdf.Text,
    Image: reactPdf.Image,
    StyleSheet: reactPdf.StyleSheet,
  };
  const buffer = await reactPdf.renderToBuffer(createElement(DocumentoLayout, { kit, modelo }));
  return new Uint8Array(buffer);
};
