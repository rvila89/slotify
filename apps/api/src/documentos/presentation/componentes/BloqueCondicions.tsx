/**
 * Bloque "Condicions" de pagament (épico #6, 6.1b; REDISEÑADO en 6.5 fiel a
 * `P2026023`): mini-tabla con borde de 3 columnas (percentatge/import/etiqueta)
 * para el reparto 40% señal / 60% liquidación / fiança "A l'arribada", rematada
 * con una línea de ACENTO AMARILLO (`COLOR_ACENTO`, constante de presentación).
 * Las etiquetas ("Pagament anticipat", "Import restant", "Fiança") y los rótulos
 * son LAYOUT FIJO; los importes vienen del modelo (reparto del régimen). No aplica
 * a la factura. Primitivas react-pdf inyectadas en `kit`.
 */
import type { RepartoDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueCondicionsProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  reparto: RepartoDocumento;
}

export const BloqueCondicions = ({ kit, estilos, reparto }: BloqueCondicionsProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.condicionsBloque}>
      <Text style={estilos.condicionsTitulo}>Condicions</Text>
      <View style={estilos.condicionsTabla}>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>40 %</Text>
          <Text style={estilos.condicionsCeldaImporte}>{reparto.senalEur} €</Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>Pagament anticipat</Text>
        </View>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>60 %</Text>
          <Text style={estilos.condicionsCeldaImporte}>{reparto.liquidacionEur} €</Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>Import restant</Text>
        </View>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>A l&apos;arribada</Text>
          <Text style={estilos.condicionsCeldaImporte}>{reparto.fianzaEur} €</Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>Fiança</Text>
        </View>
      </View>
      <View style={estilos.condicionsAcento} />
    </View>
  );
};
