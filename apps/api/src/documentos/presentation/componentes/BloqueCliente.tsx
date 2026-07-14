/**
 * Bloque de "dades client" (receptor) del documento (épico #6, 6.1b). Primitivas react-pdf
 * inyectadas en `kit`. Reutilizable por presupuesto y factura (6.3).
 */
import type { ClienteDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

export interface BloqueClienteProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  cliente: ClienteDocumento;
}

/** Une nombre y apellidos ignorando los nulos. */
const nombreCompleto = (cliente: ClienteDocumento): string =>
  [cliente.nombre, cliente.apellidos].filter((parte) => parte).join(' ');

export const BloqueCliente = ({ kit, estilos, cliente }: BloqueClienteProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>Dades del client</Text>
      <Text style={estilos.linea}>{nombreCompleto(cliente)}</Text>
      {cliente.dniNif ? (
        <Text style={estilos.linea}>DNI/NIF: {cliente.dniNif}</Text>
      ) : null}
      {cliente.direccion ? <Text style={estilos.linea}>{cliente.direccion}</Text> : null}
      <Text style={estilos.linea}>
        {[cliente.codigoPostal, cliente.poblacion, cliente.provincia]
          .filter((parte) => parte)
          .join(' - ')}
      </Text>
    </View>
  );
};
