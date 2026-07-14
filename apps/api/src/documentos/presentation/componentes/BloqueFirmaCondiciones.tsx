/**
 * Bloque de firma EN BLANCO de las "Condicions particulars" (épico #6, 6.4a). Pinta las
 * etiquetas fijas de layout (NOM I COGNOMS CLIENT / SIGNATURA CLIENT / DNI / DATA
 * ESDEVENIMENT) con una línea en blanco para rellenar a mano: el documento es idéntico
 * por tenant, sin datos de reserva. Las primitivas react-pdf llegan inyectadas en `kit`.
 */
import type { FirmaModeloCondiciones } from '../modelo-documento-condiciones';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueFirmaCondicionesProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  firma: FirmaModeloCondiciones;
}

export const BloqueFirmaCondiciones = ({
  kit,
  estilos,
  firma,
}: BloqueFirmaCondicionesProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.pie} wrap={false}>
      {firma.etiquetas.map((etiqueta) => (
        <View key={etiqueta} style={estilos.filaFirma}>
          <Text style={estilos.etiquetaFirma}>{etiqueta}</Text>
          <Text style={estilos.lineaFirma}> </Text>
        </View>
      ))}
    </View>
  );
};
