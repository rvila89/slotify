/**
 * Franja de totales del documento (épico #6, 6.1b; REDISEÑADA en 6.5 fiel a
 * `P2026023`): fila de etiquetas `Validesa Pressupost | Base imp. | % Iva | Total`
 * con sus valores debajo, separada por líneas. 6.2: la variante SIN IVA
 * (`mostrarDesgloseIva === false`) OMITE las columnas "Base imp." y "% Iva",
 * dejando `Validesa Pressupost` + `Total`; CON IVA conserva el desglose completo.
 * Layout fijo, contenido 100% del modelo. Primitivas react-pdf inyectadas en `kit`.
 * Reutilizable por factura (6.3).
 */
import type { TotalesModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueTotalesProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  totales: TotalesModelo;
  validesaTexto: string;
}

export const BloqueTotales = ({
  kit,
  estilos,
  totales,
  validesaTexto,
}: BloqueTotalesProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.totalesTabla}>
      <View style={estilos.totalesFilaEtiquetas}>
        <Text style={[estilos.totalesCeldaIzquierda, estilos.totalesEtiqueta]}>
          Validesa Pressupost
        </Text>
        {totales.mostrarDesgloseIva ? (
          <>
            <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiqueta]}>
              Base imp.
            </Text>
            <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiqueta]}>
              % Iva
            </Text>
          </>
        ) : null}
        <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiquetaDestacada]}>
          Total
        </Text>
      </View>
      <View style={estilos.totalesFilaValores}>
        <Text style={estilos.totalesCeldaIzquierda}>{validesaTexto}</Text>
        {totales.mostrarDesgloseIva ? (
          <>
            <Text style={estilos.totalesCeldaDerecha}>{totales.baseImponible} €</Text>
            <Text style={estilos.totalesCeldaDerecha}>{totales.ivaImporte} €</Text>
          </>
        ) : null}
        <Text style={[estilos.totalesCeldaDerecha, estilos.totalesValorDestacado]}>
          {totales.total} €
        </Text>
      </View>
    </View>
  );
};
