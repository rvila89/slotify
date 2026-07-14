/**
 * Layout FIJO del documento de FACTURA (épico #6, 6.3): compone cabecera, meta (número de
 * factura + fecha de emisión), dades client, concepte (sin horas) + extras, totales CON/SIN
 * IVA y pie bancario. El layout es neutro; TODO el contenido llega del `ModeloDocumentoFactura`
 * (config del tenant + datos de la factura). Reutiliza los componentes y estilos compartidos
 * del presupuesto (6.1b); NO pinta el reparto 40/60/fiança (no aplica a la factura).
 */
import type { ModeloDocumentoFactura } from '../modelo-documento-factura';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirEstilos } from '../estilos';
import { Cabecera } from './Cabecera';
import { BloqueCliente } from './BloqueCliente';
import { BloqueConceptoFactura } from './BloqueConceptoFactura';
import { PieBancario } from './PieBancario';

export interface DocumentoFacturaLayoutProps {
  kit: KitReactPdf;
  modelo: ModeloDocumentoFactura;
}

/** Título de la factura según el tipo (§D-2). */
const TITULO_POR_TIPO: Record<ModeloDocumentoFactura['tipo'], string> = {
  senal: 'Factura de senyal',
  liquidacion: 'Factura de liquidació',
  fianza: 'Rebut de fiança',
};

/** Formatea una fecha a `dd/mm/aaaa` en UTC (determinista para el documento). */
const formatearFecha = (fecha: Date): string => {
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
};

export const DocumentoFacturaLayout = ({ kit, modelo }: DocumentoFacturaLayoutProps) => {
  const { Document, Page, View, Text } = kit;
  const estilos = construirEstilos(kit.StyleSheet);
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.seccion}>
          <View style={estilos.filaMeta}>
            <Text style={estilos.negrita}>
              {TITULO_POR_TIPO[modelo.tipo]}
              {modelo.numeroFactura === null ? '' : ` núm. ${modelo.numeroFactura}`}
            </Text>
            {modelo.fechaEmision === null ? null : (
              <Text>Data: {formatearFecha(modelo.fechaEmision)}</Text>
            )}
          </View>
        </View>

        <BloqueCliente kit={kit} estilos={estilos} cliente={modelo.cliente} />

        <BloqueConceptoFactura
          kit={kit}
          estilos={estilos}
          concepto={modelo.concepto}
          extras={modelo.extras}
        />

        <View style={estilos.seccion}>
          <View style={estilos.totalesBloque}>
            {modelo.totales.mostrarDesgloseIva ? (
              <>
                <View style={estilos.totalesFila}>
                  <Text style={estilos.totalesEtiqueta}>Base imposable</Text>
                  <Text style={estilos.totalesValor}>{modelo.totales.baseImponible} €</Text>
                </View>
                <View style={estilos.totalesFila}>
                  <Text style={estilos.totalesEtiqueta}>
                    IVA ({modelo.totales.ivaPorcentaje} %)
                  </Text>
                  <Text style={estilos.totalesValor}>{modelo.totales.ivaImporte} €</Text>
                </View>
              </>
            ) : null}
            <View style={estilos.totalesFila}>
              <Text style={[estilos.totalesEtiqueta, estilos.totalDestacado]}>Total</Text>
              <Text style={[estilos.totalesValor, estilos.totalDestacado]}>
                {modelo.totales.total} €
              </Text>
            </View>
          </View>
        </View>

        {modelo.pieBancario.mostrar && (
          <PieBancario kit={kit} estilos={estilos} pieBancario={modelo.pieBancario} />
        )}

        <View style={estilos.pieLegal}>
          <Text style={estilos.linea}>{modelo.pieLegal}</Text>
        </View>
      </Page>
    </Document>
  );
};
