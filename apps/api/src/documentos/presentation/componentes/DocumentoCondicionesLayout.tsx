/**
 * Layout del documento de "Condicions particulars" (épico #6, 6.4a): compone la
 * cabecera del tenant, el título del documento, la lista de secciones y el bloque de
 * firma EN BLANCO. El layout es FIJO y neutro; TODO el contenido llega del
 * `ModeloDocumentoCondiciones` (config del tenant). Las primitivas react-pdf llegan
 * inyectadas en `kit` (no se importan estáticamente; ver `kit-react-pdf.ts`), y los
 * estilos se construyen con el `StyleSheet` del kit. Reutiliza `Cabecera` de 6.1b.
 */
import type { ModeloDocumentoCondiciones } from '../modelo-documento-condiciones';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirEstilos } from '../estilos';
import { Cabecera } from './Cabecera';
import { ListaSeccionesCondiciones } from './ListaSeccionesCondiciones';
import { BloqueFirmaCondiciones } from './BloqueFirmaCondiciones';

export interface DocumentoCondicionesLayoutProps {
  kit: KitReactPdf;
  modelo: ModeloDocumentoCondiciones;
}

export const DocumentoCondicionesLayout = ({
  kit,
  modelo,
}: DocumentoCondicionesLayoutProps) => {
  const { Document, Page, View, Text } = kit;
  const estilos = construirEstilos(kit.StyleSheet);
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.seccion}>
          <Text style={[estilos.cabeceraTitulo, { color: modelo.cabecera.colorPrimario }]}>
            {modelo.titulo}
          </Text>
        </View>

        <ListaSeccionesCondiciones kit={kit} estilos={estilos} secciones={modelo.secciones} />

        <BloqueFirmaCondiciones kit={kit} estilos={estilos} firma={modelo.firma} />
      </Page>
    </Document>
  );
};
