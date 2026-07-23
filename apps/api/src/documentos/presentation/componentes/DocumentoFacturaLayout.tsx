/**
 * Layout FIJO del documento de FACTURA (épico #6, 6.3; REDISEÑADO en 6.5 fiel al
 * lenguaje visual de `P2026023`): cabecera (logo + identidad fiscal), franja de título
 * ("FACTURA" + "Dades client" + mini-tabla `Factura | Data`), tabla de concepto (concepto
 * principal desde plantilla + subtítulo 40/60 indentado), franja de totales
 * (`Import factura` sin validez) y pie bancario centrado (solo CON IVA), precedido por una
 * línea oro divisoria (`COLOR_ACENTO`) y SIN la línea de beneficiario (change
 * `factura-pdf-fiel-referencia`, §D2–§D5). La factura NO renderiza pie legal de validez
 * (§D4: la validez es del presupuesto). Reutiliza los componentes y estilos compartidos del
 * presupuesto; NO pinta el bloque "Condicions" 40/60/fiança (no aplica a la factura).
 */
import type { ModeloDocumentoFactura } from '../modelo-documento-factura';
import type { KitReactPdf } from '../kit-react-pdf';
import { construirEstilos, COLOR_ACENTO } from '../estilos';
import { etiquetasDocumento } from '../etiquetas-por-idioma';
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

/** Título grande de la factura según el tipo (§D-2), sensible al idioma. */
const tituloPorTipo = (
  tipo: ModeloDocumentoFactura['tipo'],
  idioma: string,
): string => {
  if (tipo === 'fianza') {
    return idioma === 'es' ? 'RECIBO' : 'REBUT';
  }
  return 'FACTURA';
};

/** Rótulo de la primera columna de la mini-tabla meta según el tipo e idioma. */
const etiquetaMetaPorTipo = (
  tipo: ModeloDocumentoFactura['tipo'],
  idioma: string,
): string => {
  if (tipo === 'fianza') {
    return idioma === 'es' ? 'Recibo' : 'Rebut';
  }
  return 'Factura';
};

/** Formatea una fecha a `dd/mm/aaaa` en UTC (determinista para el documento). */
const formatearFecha = (fecha: Date): string => {
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
};

export const DocumentoFacturaLayout = ({ kit, modelo }: DocumentoFacturaLayoutProps) => {
  const { Document, Page, View } = kit;
  const estilos = construirEstilos(kit.StyleSheet);
  const colorPrimario = modelo.cabecera.colorPrimario;
  const idioma = modelo.idioma ?? 'ca';
  const etiquetas = etiquetasDocumento(idioma === 'es' ? 'es' : 'ca');
  return (
    <Document>
      <Page size="A4" style={[estilos.pagina, { color: modelo.cabecera.colorTexto }]}>
        <Cabecera kit={kit} estilos={estilos} cabecera={modelo.cabecera} />

        <View style={estilos.filaTitulo}>
          <View style={estilos.columnaCliente}>
            <BloqueCliente kit={kit} estilos={estilos} cliente={modelo.cliente} titulo={etiquetas.datosCliente} />
          </View>
          <BloqueTitulo
            kit={kit}
            estilos={estilos}
            colorPrimario={colorPrimario}
            colorTitulo={COLOR_ACENTO}
            titulo={tituloPorTipo(modelo.tipo, idioma)}
            etiquetaNumero={etiquetaMetaPorTipo(modelo.tipo, idioma)}
            etiquetaFecha={etiquetas.fecha}
            numero={modelo.numeroFactura ?? ''}
            fecha={modelo.fechaEmision === null ? '' : formatearFecha(modelo.fechaEmision)}
          />
        </View>

        <BloqueConceptoFactura
          kit={kit}
          estilos={estilos}
          colorPrimario={colorPrimario}
          etiquetaConcepto={etiquetas.concepto}
          etiquetaPrecio={etiquetas.precio}
          concepto={modelo.concepto}
          conceptoSubtitulo={modelo.conceptoSubtitulo}
          precioTotal={modelo.totales.total}
          extras={modelo.extras}
        />

        <BloqueTotales
          kit={kit}
          estilos={estilos}
          totales={modelo.totales}
          etiquetas={etiquetas}
          etiquetaIzquierda={etiquetas.importFactura}
          valorIzquierda=""
        />

        {modelo.pieBancario.mostrar && (
          <View>
            <View style={[estilos.condicionsAcento, { marginTop: 12, marginBottom: 4 }]} />
            <PieBancario
              kit={kit}
              estilos={estilos}
              pieBancario={modelo.pieBancario}
              etiquetas={etiquetas}
              email={modelo.cabecera.email}
              mostrarBeneficiario={false}
            />
          </View>
        )}
      </Page>
    </Document>
  );
};
