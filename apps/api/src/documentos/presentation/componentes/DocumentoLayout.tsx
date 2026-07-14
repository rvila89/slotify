/**
 * Layout FIJO del documento (épico #6, 6.1b): compone cabecera, meta (número + fecha),
 * dades client, concepte + extras, totales CON IVA + condicions + validesa, y pie
 * bancario. El layout es neutro; TODO el contenido llega del `ModeloDocumentoPresupuesto`
 * (config del tenant + datos). Las primitivas react-pdf llegan inyectadas en `kit` (no se
 * importan estáticamente; ver `kit-react-pdf.ts`), y los estilos se construyen con el
 * `StyleSheet` del kit. Pensado para reutilizarse en la factura (6.3).
 */
import type { ModeloDocumentoPresupuesto } from '../modelo-documento-presupuesto';
import type { KitReactPdf } from './kit-react-pdf';
import { construirEstilos } from './estilos';
import { Cabecera } from './Cabecera';
import { BloqueCliente } from './BloqueCliente';
import { TablaConcepto } from './TablaConcepto';
import { BloqueTotales } from './BloqueTotales';
import { PieBancario } from './PieBancario';

export interface DocumentoLayoutProps {
  kit: KitReactPdf;
  modelo: ModeloDocumentoPresupuesto;
}

/** Formatea una fecha a `dd/mm/aaaa` en UTC (determinista para el documento). */
const formatearFecha = (fecha: Date): string => {
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
};

export const DocumentoLayout = ({ kit, modelo }: DocumentoLayoutProps) => {
  const { Document, Page, View, Text } = kit;
  const estilos = construirEstilos(kit.StyleSheet);
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.seccion}>
          <View style={estilos.filaMeta}>
            <Text style={estilos.negrita}>
              Pressupost núm. {modelo.numeroPresupuesto}
            </Text>
            <Text>Data: {formatearFecha(modelo.fecha)}</Text>
          </View>
        </View>

        <BloqueCliente kit={kit} estilos={estilos} cliente={modelo.cliente} />

        <TablaConcepto
          kit={kit}
          estilos={estilos}
          conceptoPrincipal={modelo.conceptoPrincipal}
          duracionTexto={modelo.duracionTexto}
          fechaEvento={modelo.fechaEvento}
          numPersonas={modelo.numPersonas}
          extras={modelo.extras}
        />

        <BloqueTotales
          kit={kit}
          estilos={estilos}
          totales={modelo.totales}
          reparto={modelo.reparto}
          validesaTexto={modelo.validesaTexto}
        />

        <PieBancario
          kit={kit}
          estilos={estilos}
          pieBancario={modelo.pieBancario}
          pieLegal={modelo.pieLegal}
        />
      </Page>
    </Document>
  );
};
