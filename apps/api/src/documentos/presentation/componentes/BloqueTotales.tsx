/**
 * Bloque de totales CON IVA (base / %IVA / IVA / total) + condicions de pagament
 * 40/60/fiança + validesa (épico #6, 6.1b). Primitivas react-pdf inyectadas en `kit`.
 * Reutilizable por factura (6.3).
 */
import type {
  DesgloseDocumento,
  RepartoDocumento,
} from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueTotalesProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  totales: DesgloseDocumento;
  reparto: RepartoDocumento;
  validesaTexto: string;
}

export const BloqueTotales = ({
  kit,
  estilos,
  totales,
  reparto,
  validesaTexto,
}: BloqueTotalesProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.seccion}>
      <View style={estilos.totalesBloque}>
        <View style={estilos.totalesFila}>
          <Text style={estilos.totalesEtiqueta}>Base imposable</Text>
          <Text style={estilos.totalesValor}>{totales.baseImponible} €</Text>
        </View>
        <View style={estilos.totalesFila}>
          <Text style={estilos.totalesEtiqueta}>IVA ({totales.ivaPorcentaje} %)</Text>
          <Text style={estilos.totalesValor}>{totales.ivaImporte} €</Text>
        </View>
        <View style={estilos.totalesFila}>
          <Text style={[estilos.totalesEtiqueta, estilos.totalDestacado]}>Total</Text>
          <Text style={[estilos.totalesValor, estilos.totalDestacado]}>
            {totales.total} €
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 12 }}>
        <Text style={estilos.seccionTitulo}>Condicions de pagament</Text>
        <Text style={estilos.linea}>Senyal (a la reserva): {reparto.senalEur} €</Text>
        <Text style={estilos.linea}>Liquidació: {reparto.liquidacionEur} €</Text>
        <Text style={estilos.linea}>Fiança (a part): {reparto.fianzaEur} €</Text>
      </View>
      <Text style={estilos.validesa}>Validesa: {validesaTexto}</Text>
    </View>
  );
};
