/**
 * Tabla de concepto principal + extras (épico #6, 6.1b; REDISEÑADA en 6.5 fiel a
 * `P2026023`): barra turquesa con cabecera blanca `CONCEPTE | PREU`; cuerpo con
 * borde alto; concepto principal en negrita con su PREU (total) a la derecha y
 * líneas indentadas (data / hores / persones); extras como sub-conceptos con
 * precio. El concepto ya llega resuelto (`{nombreComercial}` sustituido, NUNCA
 * "lloguer"). Primitivas react-pdf inyectadas en `kit`.
 */
import type { ExtraDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface TablaConceptoProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  colorPrimario: string;
  conceptoPrincipal: string;
  /** Texto de duración "(N hores)" que acompaña al concepto (N5). */
  duracionTexto: string;
  fechaEvento: Date;
  numPersonas: number;
  /** PREU del concepto principal (total del documento) en formato "0.00". */
  precioTotal: string;
  extras: ReadonlyArray<ExtraDocumento>;
}

/** Formatea una fecha a `dd/mm/aaaa` en UTC (determinista para el documento). */
const formatearFecha = (fecha: Date): string => {
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
};

export const TablaConcepto = ({
  kit,
  estilos,
  colorPrimario,
  conceptoPrincipal,
  duracionTexto,
  fechaEvento,
  numPersonas,
  precioTotal,
  extras,
}: TablaConceptoProps) => {
  const { View, Text } = kit;
  return (
    <View>
      <View style={[estilos.conceptoCabeceraBarra, { backgroundColor: colorPrimario }]}>
        <Text style={estilos.conceptoCabeceraConcepto}>CONCEPTE</Text>
        <Text style={estilos.conceptoCabeceraPreu}>PREU</Text>
      </View>
      <View style={estilos.conceptoCuerpo}>
        <View style={estilos.conceptoFilaPrincipal}>
          <Text style={estilos.conceptoPrincipalTexto}>{conceptoPrincipal}</Text>
          <Text style={estilos.conceptoPrecio}>{precioTotal} €</Text>
        </View>
        <Text style={estilos.conceptoDetalleLinea}>{formatearFecha(fechaEvento)}</Text>
        <Text style={estilos.conceptoDetalleLinea}>{duracionTexto}</Text>
        <Text style={estilos.conceptoDetalleLinea}>{numPersonas} persones</Text>
        {extras.map((extra, indice) => (
          <View style={estilos.conceptoExtraFila} key={`${extra.descripcion}-${indice}`}>
            <Text style={estilos.conceptoExtraTexto}>{extra.descripcion}</Text>
            <Text style={estilos.conceptoPrecio}>{extra.importeEur} €</Text>
          </View>
        ))}
      </View>
    </View>
  );
};
