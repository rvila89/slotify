/**
 * Franja de totales del documento (épico #6, 6.1b; REDISEÑADA en 6.5 fiel a
 * `P2026023`; rótulos por idioma en `pdf-presupuesto-horario-idioma`): fila de etiquetas
 * `Validesa | Base imposable | % Iva | Total` con sus valores debajo, separada por líneas.
 * 6.2: la variante SIN IVA (`mostrarDesgloseIva === false`) OMITE "Base imposable" y
 * "% Iva", dejando `Validesa` + `Total`; CON IVA conserva el desglose completo. Los
 * rótulos llegan traducidos en `etiquetas`; el resto del contenido, del modelo. Layout
 * fijo. Primitivas react-pdf inyectadas en `kit`. Reutilizable por factura (6.3).
 */
import { formatearImporteDocumento } from '../formato-importe';
import type { EtiquetasDocumento } from '../etiquetas-por-idioma';
import type { TotalesModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueTotalesProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  totales: TotalesModelo;
  /** Etiquetas fijas por idioma (baseImponible/ivaPct/total). */
  etiquetas: EtiquetasDocumento;
  /**
   * Etiqueta de la columna IZQUIERDA de la franja (change `factura-pdf-fiel-referencia`, §D3):
   * presupuesto → `etiquetas.validesa`; factura → `etiquetas.importFactura`.
   */
  etiquetaIzquierda: string;
  /**
   * Valor bajo la etiqueta izquierda (§D3): presupuesto → `validesaTexto`; factura → `""`
   * (celda vacía, fiel a la referencia).
   */
  valorIzquierda: string;
}

export const BloqueTotales = ({
  kit,
  estilos,
  totales,
  etiquetas,
  etiquetaIzquierda,
  valorIzquierda,
}: BloqueTotalesProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.totalesTabla}>
      <View style={estilos.totalesFilaEtiquetas}>
        <Text style={[estilos.totalesCeldaIzquierda, estilos.totalesEtiqueta]}>
          {etiquetaIzquierda}
        </Text>
        {totales.mostrarDesgloseIva ? (
          <>
            <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiqueta]}>
              {etiquetas.baseImponible}
            </Text>
            <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiqueta]}>
              {etiquetas.ivaPct}
            </Text>
          </>
        ) : null}
        <Text style={[estilos.totalesCeldaDerecha, estilos.totalesEtiquetaDestacada]}>
          {etiquetas.total}
        </Text>
      </View>
      <View style={estilos.totalesFilaValores}>
        <Text style={estilos.totalesCeldaIzquierda}>{valorIzquierda}</Text>
        {totales.mostrarDesgloseIva ? (
          <>
            <Text style={estilos.totalesCeldaDerecha}>
              {formatearImporteDocumento(totales.baseImponible)} €
            </Text>
            <Text style={estilos.totalesCeldaDerecha}>
              {formatearImporteDocumento(totales.ivaImporte)} €
            </Text>
          </>
        ) : null}
        <Text style={[estilos.totalesCeldaDerecha, estilos.totalesValorDestacado]}>
          {formatearImporteDocumento(totales.total)} €
        </Text>
      </View>
    </View>
  );
};
