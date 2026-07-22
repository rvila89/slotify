/**
 * Tabla de concepto principal + extras (épico #6, 6.1b; REDISEÑADA en 6.5 fiel a
 * `P2026023`; ampliada en el change `pdf-presupuesto-horario-idioma`): barra turquesa
 * con cabecera blanca `CONCEPTE|PREU` (rótulos por idioma); cuerpo con borde alto;
 * concepto principal en negrita con su PREU (total) a la derecha y TRES líneas
 * indentadas legibles: fecha del evento "D de mes de AAAA", rango horario
 * "De HH:MM a HH:MM (N hores)" y "N persones/personas"; extras como sub-conceptos con
 * precio. Todos los strings llegan ya resueltos del modelo (fecha/horario/personas y
 * concepto con `{nombreComercial}` sustituido, NUNCA "lloguer"). Primitivas react-pdf
 * inyectadas en `kit`.
 */
import { formatearImporteDocumento } from '../formato-importe';
import type { EtiquetasDocumento } from '../etiquetas-por-idioma';
import type { ExtraDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface TablaConceptoProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  colorPrimario: string;
  /** Etiquetas fijas por idioma (cabeceras `concepto`/`precio`, palabra `personas`). */
  etiquetas: EtiquetasDocumento;
  conceptoPrincipal: string;
  /** Fecha del evento ya formateada "D de mes de AAAA" (Mejora 1). */
  fechaEventoTexto: string;
  /** Rango horario ya formateado "De HH:MM a HH:MM (N hores)" o fallback (Mejora 1). */
  horarioTexto: string;
  numPersonas: number;
  /** PREU del concepto principal (total del documento) en formato "0.00". */
  precioTotal: string;
  extras: ReadonlyArray<ExtraDocumento>;
}

export const TablaConcepto = ({
  kit,
  estilos,
  colorPrimario,
  etiquetas,
  conceptoPrincipal,
  fechaEventoTexto,
  horarioTexto,
  numPersonas,
  precioTotal,
  extras,
}: TablaConceptoProps) => {
  const { View, Text } = kit;
  return (
    <View>
      <View style={[estilos.conceptoCabeceraBarra, { backgroundColor: colorPrimario }]}>
        <Text style={estilos.conceptoCabeceraConcepto}>{etiquetas.concepto}</Text>
        <Text style={estilos.conceptoCabeceraPreu}>{etiquetas.precio}</Text>
      </View>
      <View style={estilos.conceptoCuerpo}>
        <View style={estilos.conceptoFilaPrincipal}>
          <Text style={estilos.conceptoPrincipalTexto}>{conceptoPrincipal}</Text>
          <Text style={estilos.conceptoPrecio}>{formatearImporteDocumento(precioTotal)} €</Text>
        </View>
        <Text style={estilos.conceptoDetalleLinea}>{fechaEventoTexto}</Text>
        <Text style={estilos.conceptoDetalleLinea}>{horarioTexto}</Text>
        <Text style={estilos.conceptoDetalleLinea}>
          {`${numPersonas} ${etiquetas.personas}`}
        </Text>
        {extras.map((extra, indice) => (
          <View style={estilos.conceptoExtraFila} key={`${extra.descripcion}-${indice}`}>
            <Text style={estilos.conceptoExtraTexto}>{extra.descripcion}</Text>
            <Text style={estilos.conceptoPrecio}>{formatearImporteDocumento(extra.importeEur)} €</Text>
          </View>
        ))}
      </View>
    </View>
  );
};
