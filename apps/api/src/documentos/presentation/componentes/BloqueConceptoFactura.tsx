/**
 * Bloque de concepto de la FACTURA (épico #6, 6.3). A diferencia de `TablaConcepto` del
 * presupuesto, el concepto de la factura NO lleva horas ni fecha de evento ni nº de personas:
 * es un texto fiscal único (§D-2) generado según el tipo (señal/liquidación/fianza), con los
 * extras de la liquidación como sub-conceptos con su subtotal. Primitivas react-pdf inyectadas
 * en `kit`. Reutiliza el layout y estilos compartidos.
 */
import type { ExtraFactura } from '../modelo-documento-factura';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueConceptoFacturaProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  concepto: string;
  extras?: ReadonlyArray<ExtraFactura>;
}

export const BloqueConceptoFactura = ({
  kit,
  estilos,
  concepto,
  extras = [],
}: BloqueConceptoFacturaProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>Concepte</Text>
      <View style={estilos.tablaFila}>
        <Text style={estilos.tablaConcepto}>{concepto}</Text>
      </View>
      {extras.map((extra, indice) => (
        <View style={estilos.tablaFila} key={`${extra.descripcion}-${indice}`}>
          <Text style={estilos.tablaConcepto}>{extra.descripcion}</Text>
          <Text style={estilos.tablaImporte}>{extra.subtotal} €</Text>
        </View>
      ))}
    </View>
  );
};
