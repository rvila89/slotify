/**
 * Bloque de TÍTULO del documento (épico #6, 6.5, fiel a `P2026023`): título grande en
 * turquesa ("PRESSUPOST" / "FACTURA") + mini-tabla con borde de dos columnas
 * (`etiqueta | Data`) con el número y la fecha del documento. Es la columna DERECHA de
 * la franja de título (la izquierda es "Dades client"). Los rótulos de columna son
 * LAYOUT FIJO; el título, número y fecha llegan como props. Primitivas react-pdf
 * inyectadas en `kit`. Reutilizable por presupuesto y factura.
 */
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueTituloProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  colorPrimario: string;
  /** Título grande del documento, p. ej. "PRESSUPOST" o "FACTURA". */
  titulo: string;
  /** Rótulo de la primera columna de la mini-tabla, p. ej. "Pressupost" o "Factura". */
  etiquetaNumero: string;
  /** Número del documento (o cadena vacía si aún no está numerado). */
  numero: string;
  /** Fecha del documento en `dd/mm/aaaa` (o cadena vacía si no aplica). */
  fecha: string;
}

export const BloqueTitulo = ({
  kit,
  estilos,
  colorPrimario,
  titulo,
  etiquetaNumero,
  numero,
  fecha,
}: BloqueTituloProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.columnaTitulo}>
      <Text style={[estilos.tituloDocumento, { color: colorPrimario }]}>{titulo}</Text>
      <View style={estilos.tablaMeta}>
        <View style={estilos.tablaMetaFila}>
          <Text style={estilos.tablaMetaCeldaEtiqueta}>{etiquetaNumero}</Text>
          <Text style={estilos.tablaMetaCeldaEtiquetaUltima}>Data</Text>
        </View>
        <View style={estilos.tablaMetaFila}>
          <Text style={estilos.tablaMetaCeldaValor}>{numero}</Text>
          <Text style={estilos.tablaMetaCeldaValorUltima}>{fecha}</Text>
        </View>
      </View>
    </View>
  );
};
