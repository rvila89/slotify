/**
 * Layout FIJO del documento de FACTURA (épico #6, 6.3; REDISEÑADO en 6.5 fiel al
 * lenguaje visual de `P2026023`): cabecera (logo + identidad fiscal), franja de título
 * ("FACTURA" + "Dades client" + mini-tabla `Factura | Data`), tabla de concepto (barra
 * turquesa `CONCEPTE | PREU`), franja de totales (`Validesa | Base imp. | % Iva |
 * Total`), pie bancario centrado (solo CON IVA) y pie legal (SIEMPRE). Reutiliza los
 * componentes y estilos compartidos del presupuesto; NO pinta el bloque "Condicions"
 * 40/60/fiança (no aplica a la factura).
 */
import type { ModeloDocumentoFactura } from '../modelo-documento-factura';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirEstilos } from '../estilos';
import { Cabecera } from './Cabecera';
import { BloqueCliente } from './BloqueCliente';
import { BloqueTitulo } from './BloqueTitulo';
import { BloqueConceptoFactura } from './BloqueConceptoFactura';
import { BloqueTotales } from './BloqueTotales';
import { PieBancario } from './PieBancario';

export interface DocumentoFacturaLayoutProps {
  kit: KitReactPdf;
  modelo: ModeloDocumentoFactura;
}

/** Título grande de la factura según el tipo (§D-2). */
const TITULO_POR_TIPO: Record<ModeloDocumentoFactura['tipo'], string> = {
  senal: 'FACTURA',
  liquidacion: 'FACTURA',
  fianza: 'REBUT',
};

/** Rótulo de la primera columna de la mini-tabla meta según el tipo. */
const ETIQUETA_META_POR_TIPO: Record<ModeloDocumentoFactura['tipo'], string> = {
  senal: 'Factura',
  liquidacion: 'Factura',
  fianza: 'Rebut',
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
  const colorPrimario = modelo.cabecera.colorPrimario;
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.filaTitulo}>
          <View style={estilos.columnaCliente}>
            <BloqueCliente kit={kit} estilos={estilos} cliente={modelo.cliente} />
          </View>
          <BloqueTitulo
            kit={kit}
            estilos={estilos}
            colorPrimario={colorPrimario}
            titulo={TITULO_POR_TIPO[modelo.tipo]}
            etiquetaNumero={ETIQUETA_META_POR_TIPO[modelo.tipo]}
            numero={modelo.numeroFactura ?? ''}
            fecha={modelo.fechaEmision === null ? '' : formatearFecha(modelo.fechaEmision)}
          />
        </View>

        <BloqueConceptoFactura
          kit={kit}
          estilos={estilos}
          colorPrimario={colorPrimario}
          concepto={modelo.concepto}
          precioTotal={modelo.totales.total}
          extras={modelo.extras}
        />

        <BloqueTotales
          kit={kit}
          estilos={estilos}
          totales={modelo.totales}
          validesaTexto=""
        />

        {modelo.pieBancario.mostrar && (
          <PieBancario
            kit={kit}
            estilos={estilos}
            pieBancario={modelo.pieBancario}
            email={modelo.cabecera.email}
          />
        )}

        <View style={{ marginTop: 12 }}>
          <Text style={estilos.pieLinea}>{modelo.pieLegal}</Text>
        </View>
      </Page>
    </Document>
  );
};
