/**
 * Layout FIJO del documento de PRESUPUESTO (épico #6, 6.1b; REDISEÑADO en 6.5 fiel a
 * `P2026023`): cabecera (logo + identidad fiscal), franja de título ("PRESSUPOST" +
 * "Dades client" + mini-tabla `Pressupost | Data`), tabla de concepto (barra turquesa
 * `CONCEPTE | PREU` + cuerpo), franja de totales (`Validesa | Base imp. | % Iva |
 * Total`), bloque "Condicions" (mini-tabla 40/60/fiança + acento amarillo), pie
 * bancario centrado (solo CON IVA) y pie legal (SIEMPRE). El layout es neutro; TODO
 * el contenido llega del `ModeloDocumentoPresupuesto`. Las primitivas react-pdf llegan
 * inyectadas en `kit`; los estilos se construyen con el `StyleSheet` del kit.
 */
import type { ModeloDocumentoPresupuesto } from '../modelo-documento-presupuesto';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirEstilos, COLOR_ACENTO } from '../estilos';
import { Cabecera } from './Cabecera';
import { BloqueCliente } from './BloqueCliente';
import { BloqueTitulo } from './BloqueTitulo';
import { TablaConcepto } from './TablaConcepto';
import { BloqueTotales } from './BloqueTotales';
import { BloqueCondicions } from './BloqueCondicions';
import { PieBancario } from './PieBancario';

export interface DocumentoLayoutProps {
  kit: KitReactPdf;
  modelo: ModeloDocumentoPresupuesto;
}

/** Formatea una fecha a `dd/mm/aaaa` en UTC (fecha de emisión del documento). */
const formatearFecha = (fecha: Date): string => {
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
};

export const DocumentoLayout = ({ kit, modelo }: DocumentoLayoutProps) => {
  const { Document, Page, View, Text } = kit;
  const estilos = construirEstilos(kit.StyleSheet);
  const colorPrimario = modelo.cabecera.colorPrimario;
  const etiquetas = modelo.etiquetas;
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.filaTitulo}>
          <View style={estilos.columnaCliente}>
            <BloqueCliente
              kit={kit}
              estilos={estilos}
              cliente={modelo.cliente}
              titulo={etiquetas.datosCliente}
            />
          </View>
          <BloqueTitulo
            kit={kit}
            estilos={estilos}
            colorPrimario={colorPrimario}
            colorTitulo={COLOR_ACENTO}
            titulo={etiquetas.titulo}
            etiquetaNumero={etiquetas.numeroDoc}
            etiquetaFecha={etiquetas.fecha}
            numero={modelo.numeroPresupuesto}
            fecha={formatearFecha(modelo.fecha)}
          />
        </View>

        <TablaConcepto
          kit={kit}
          estilos={estilos}
          colorPrimario={colorPrimario}
          etiquetas={etiquetas}
          conceptoPrincipal={modelo.conceptoPrincipal}
          fechaEventoTexto={modelo.fechaEventoTexto}
          horarioTexto={modelo.horarioTexto}
          numPersonas={modelo.numPersonas}
          precioTotal={modelo.totales.total}
          extras={modelo.extras}
        />

        <BloqueTotales
          kit={kit}
          estilos={estilos}
          totales={modelo.totales}
          etiquetas={etiquetas}
          validesaTexto={modelo.validesaTexto}
        />

        <BloqueCondicions
          kit={kit}
          estilos={estilos}
          etiquetas={etiquetas}
          reparto={modelo.reparto}
        />

        {modelo.pieBancario.mostrar && (
          <PieBancario
            kit={kit}
            estilos={estilos}
            pieBancario={modelo.pieBancario}
            etiquetas={etiquetas}
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
