/**
 * Bloque de concepto de la FACTURA (épico #6, 6.3; REDISEÑADO en 6.5 fiel al lenguaje
 * visual de `P2026023`): barra turquesa `CONCEPTE | PREU` + cuerpo con borde. A
 * diferencia de `TablaConcepto` del presupuesto, el concepto de la factura NO lleva
 * horas ni fecha ni nº de personas: es un texto fiscal único (§D-2) según el tipo
 * (señal/liquidación/fianza), con los extras como sub-conceptos con su subtotal.
 * Primitivas react-pdf inyectadas en `kit`.
 */
import type { ExtraFactura } from '../modelo-documento-factura';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueConceptoFacturaProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  colorPrimario: string;
  /** Cabecera de la columna de concepto ("CONCEPTE"/"CONCEPTO"). */
  etiquetaConcepto: string;
  /** Cabecera de la columna de precio ("PREU"/"PRECIO"). */
  etiquetaPrecio: string;
  concepto: string;
  /** PREU del concepto principal (total del documento) en formato "0.00". */
  precioTotal: string;
  extras?: ReadonlyArray<ExtraFactura>;
}

export const BloqueConceptoFactura = ({
  kit,
  estilos,
  colorPrimario,
  etiquetaConcepto,
  etiquetaPrecio,
  concepto,
  precioTotal,
  extras = [],
}: BloqueConceptoFacturaProps) => {
  const { View, Text } = kit;
  return (
    <View>
      <View style={[estilos.conceptoCabeceraBarra, { backgroundColor: colorPrimario }]}>
        <Text style={estilos.conceptoCabeceraConcepto}>{etiquetaConcepto}</Text>
        <Text style={estilos.conceptoCabeceraPreu}>{etiquetaPrecio}</Text>
      </View>
      <View style={estilos.conceptoCuerpo}>
        <View style={estilos.conceptoFilaPrincipal}>
          <Text style={estilos.conceptoPrincipalTexto}>{concepto}</Text>
          <Text style={estilos.conceptoPrecio}>{precioTotal} €</Text>
        </View>
        {extras.map((extra, indice) => (
          <View style={estilos.conceptoExtraFila} key={`${extra.descripcion}-${indice}`}>
            <Text style={estilos.conceptoExtraTexto}>{extra.descripcion}</Text>
            <Text style={estilos.conceptoPrecio}>{extra.subtotal} €</Text>
          </View>
        ))}
      </View>
    </View>
  );
};
