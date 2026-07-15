/**
 * Render del documento de FACTURA a BYTES de PDF (épico #6, 6.3) — capa de presentación de
 * `documentos`.
 *
 * `renderizarDocumentoFacturaABytes(modelo)` compone el layout de la factura inyectándole las
 * primitivas de react-pdf y delega en `renderToBuffer`. Devuelve un `Buffer` que empieza por
 * la firma `%PDF`. Reutiliza los componentes compartidos (`Cabecera`, `BloqueCliente`,
 * `PieBancario`, `estilos`) y `BloqueConceptoFactura` (concepto sin horas). El desglose de
 * totales se pinta según el flag CON/SIN IVA del modelo (misma semántica que el presupuesto,
 * pero sin reparto 40/60/fiança, que no aplica a la factura).
 *
 * INTEROP ESM: `@react-pdf/renderer` es ESM puro (sin build CommonJS); este módulo compila a
 * CommonJS (NestJS). Se carga con `import()` NATIVO a través de un `Function` para que
 * TypeScript NO lo transpile a `require` (que rompería el ESM). Los componentes `.tsx` NO
 * importan react-pdf: reciben sus primitivas (`kit`) desde aquí.
 */
import { createElement } from 'react';
import type { ModeloDocumentoFactura } from './modelo-documento-factura';
import { resolverCabeceraConLogoDataUri } from './resolver-logo-data-uri';
import { DocumentoFacturaLayout } from './componentes/DocumentoFacturaLayout';
import type { KitReactPdf } from './kit-react-pdf';
import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';

/** Módulo react-pdf cargado dinámicamente (subconjunto que usamos). */
interface ModuloReactPdf extends KitReactPdf {
  renderToBuffer: (documento: unknown) => Promise<Buffer>;
}

/** Import dinámico NATIVO (no transpilado a `require` por TypeScript). */
const importarNativo = (especificador: string): Promise<unknown> =>
  (Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(especificador);

export const renderizarDocumentoFacturaABytes = async (
  modelo: ModeloDocumentoFactura,
  almacen?: AlmacenDocumentosPort,
): Promise<Buffer> => {
  // 6.5: resuelve el logo de la cabecera a data-URI desde el almacén (bytes, no HTTP);
  // sin almacén/sin logo/clave inexistente → cabecera solo-texto.
  const cabecera = await resolverCabeceraConLogoDataUri(modelo.cabecera, almacen);
  const modeloConLogo: ModeloDocumentoFactura = { ...modelo, cabecera };
  const reactPdf = (await importarNativo('@react-pdf/renderer')) as ModuloReactPdf;
  const kit: KitReactPdf = {
    Document: reactPdf.Document,
    Page: reactPdf.Page,
    View: reactPdf.View,
    Text: reactPdf.Text,
    Image: reactPdf.Image,
    StyleSheet: reactPdf.StyleSheet,
  };
  return reactPdf.renderToBuffer(
    createElement(DocumentoFacturaLayout, { kit, modelo: modeloConLogo }),
  );
};
