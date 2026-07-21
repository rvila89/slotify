/**
 * Bloque "Condicions" de pagament (épico #6, 6.1b; REDISEÑADO en 6.5 fiel a
 * `P2026023`): mini-tabla con borde de 3 columnas (percentatge/import/etiqueta)
 * para el reparto 40% señal / 60% liquidación / fiança "A l'arribada", rematada
 * con una línea de ACENTO AMARILLO (`COLOR_ACENTO`, constante de presentación).
 * Las etiquetas ("Pagament anticipat", "Import restant", "Fiança") y los rótulos
 * son LAYOUT FIJO; los importes vienen del modelo (reparto del régimen). No aplica
 * a la factura. Primitivas react-pdf inyectadas en `kit`.
 */
import { formatearImporteDocumento } from '../formato-importe';
import type { EtiquetasDocumento } from '../etiquetas-por-idioma';
import type { RepartoDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueCondicionsProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  /** Etiquetas fijas por idioma (título/reparto/fianza del bloque). */
  etiquetas: EtiquetasDocumento;
  reparto: RepartoDocumento;
}

export const BloqueCondicions = ({
  kit,
  estilos,
  etiquetas,
  reparto,
}: BloqueCondicionsProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.condicionsBloque}>
      <Text style={estilos.condicionsTitulo}>{etiquetas.condiciones}</Text>
      <View style={estilos.condicionsTabla}>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>40 %</Text>
          <Text style={estilos.condicionsCeldaImporte}>
            {formatearImporteDocumento(reparto.senalEur)} €
          </Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>{etiquetas.pagamentAnticipat}</Text>
        </View>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>60 %</Text>
          <Text style={estilos.condicionsCeldaImporte}>
            {formatearImporteDocumento(reparto.liquidacionEur)} €
          </Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>{etiquetas.importRestant}</Text>
        </View>
        <View style={estilos.condicionsFila}>
          <Text style={estilos.condicionsCeldaPct}>{etiquetas.aLarribada}</Text>
          <Text style={estilos.condicionsCeldaImporte}>
            {formatearImporteDocumento(reparto.fianzaEur)} €
          </Text>
          <Text style={estilos.condicionsCeldaEtiqueta}>{etiquetas.fianza}</Text>
        </View>
      </View>
      <View style={estilos.condicionsAcento} />
    </View>
  );
};
