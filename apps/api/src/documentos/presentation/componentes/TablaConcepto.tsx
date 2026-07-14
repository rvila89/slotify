/**
 * Tabla de concepto principal + extras como sub-conceptos (épico #6, 6.1b). El concepto
 * principal ya llega resuelto (`{nombreComercial}` sustituido, NUNCA "lloguer"). Primitivas
 * react-pdf inyectadas en `kit`. Reutilizable por factura (6.3) con otro concepto.
 */
import type { ExtraDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

export interface TablaConceptoProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  conceptoPrincipal: string;
  /** Texto de duración "(N hores)" que acompaña al concepto (N5). */
  duracionTexto: string;
  fechaEvento: Date;
  numPersonas: number;
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
  conceptoPrincipal,
  duracionTexto,
  fechaEvento,
  numPersonas,
  extras,
}: TablaConceptoProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>Concepte</Text>
      <View style={estilos.tablaFila}>
        <Text style={estilos.tablaConcepto}>
          {conceptoPrincipal} {duracionTexto} — {formatearFecha(fechaEvento)} —{' '}
          {numPersonas} persones
        </Text>
      </View>
      {extras.map((extra, indice) => (
        <View style={estilos.tablaFila} key={`${extra.descripcion}-${indice}`}>
          <Text style={estilos.tablaConcepto}>{extra.descripcion}</Text>
          <Text style={estilos.tablaImporte}>{extra.importeEur} €</Text>
        </View>
      ))}
    </View>
  );
};
