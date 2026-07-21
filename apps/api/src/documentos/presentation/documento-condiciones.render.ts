/**
 * Render del documento de "Condicions particulars" a BYTES de PDF (épico #6, rebanada
 * 6.4a) — capa de presentación de `documentos`.
 *
 * `renderizarDocumentoCondicionesABytes(config)` construye el modelo de vista
 * (`construirModeloDocumentoCondiciones`), compone `DocumentoCondicionesLayout`
 * inyectándole las primitivas de react-pdf y delega en `renderToBuffer`. Devuelve un
 * `Uint8Array` que empieza por la firma `%PDF`. Esta firma `(config) => Promise<Uint8Array>`
 * es la que inyecta el adaptador real de PDF de condiciones.
 *
 * INTEROP ESM: `@react-pdf/renderer` es ESM puro (sin build CommonJS); este módulo compila
 * a CommonJS (NestJS). Se carga con `import()` NATIVO a través de un `Function` para que
 * TypeScript NO lo transpile a `require` (que rompería el ESM). En runtime requiere el
 * loader ESM de Node (`--experimental-vm-modules` bajo Jest; nativo en Node en producción).
 * Los componentes `.tsx` NO importan react-pdf: reciben sus primitivas (`kit`) desde aquí.
 */
import { createElement } from 'react';
import { construirModeloDocumentoCondiciones } from './modelo-documento-condiciones';
import { resolverConfigConLogoDataUri } from './resolver-logo-data-uri';
import { DocumentoCondicionesLayout } from './componentes/DocumentoCondicionesLayout';
import type { KitReactPdf } from './kit-react-pdf';
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';
import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';

/** Módulo react-pdf cargado dinámicamente (subconjunto que usamos). */
interface ModuloReactPdf extends KitReactPdf {
  renderToBuffer: (documento: unknown) => Promise<Buffer>;
}

/** Import dinámico NATIVO (no transpilado a `require` por TypeScript). */
const importarNativo = (especificador: string): Promise<unknown> =>
  (Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(especificador);

export const renderizarDocumentoCondicionesABytes = async (
  config: ConfiguracionDocumentoTenant,
  almacen?: AlmacenDocumentosPort,
  idioma: 'es' | 'ca' = 'ca',
): Promise<Uint8Array> => {
  // 6.5: logo a data-URI desde el almacén (bytes, no HTTP); sin logo → solo-texto.
  const configConLogo = await resolverConfigConLogoDataUri(config, almacen);
  // Mejora A: el idioma de la reserva selecciona el texto del JSON bilingüe.
  const modelo = construirModeloDocumentoCondiciones(configConLogo, idioma);
  const reactPdf = (await importarNativo('@react-pdf/renderer')) as ModuloReactPdf;
  const kit: KitReactPdf = {
    Document: reactPdf.Document,
    Page: reactPdf.Page,
    View: reactPdf.View,
    Text: reactPdf.Text,
    Image: reactPdf.Image,
    StyleSheet: reactPdf.StyleSheet,
  };
  const buffer = await reactPdf.renderToBuffer(
    createElement(DocumentoCondicionesLayout, { kit, modelo }),
  );
  return new Uint8Array(buffer);
};
