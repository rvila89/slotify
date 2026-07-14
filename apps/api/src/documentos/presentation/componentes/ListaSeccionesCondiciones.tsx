/**
 * Lista de secciones de las "Condicions particulars" (épico #6, 6.4a): por cada
 * sección, su título en negrita y el cuerpo (posiblemente multi-línea). Layout FIJO;
 * el contenido llega del modelo. Las primitivas react-pdf llegan inyectadas en `kit`
 * (no se importan estáticamente; ver `kit-react-pdf.ts`).
 */
import type { SeccionModeloCondiciones } from '../modelo-documento-condiciones';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface ListaSeccionesCondicionesProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  secciones: ReadonlyArray<SeccionModeloCondiciones>;
}

export const ListaSeccionesCondiciones = ({
  kit,
  estilos,
  secciones,
}: ListaSeccionesCondicionesProps) => {
  const { View, Text } = kit;
  return (
    <View>
      {secciones.map((seccion, indice) => (
        <View key={`${indice}-${seccion.titulo}`} style={estilos.seccion} wrap={false}>
          <Text style={estilos.seccionTitulo}>{seccion.titulo}</Text>
          <Text style={estilos.linea}>{seccion.cuerpo}</Text>
        </View>
      ))}
    </View>
  );
};
