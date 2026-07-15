/**
 * Bloque "Dades client" (receptor) del documento (épico #6, 6.1b; REDISEÑADO en 6.5
 * fiel a `P2026023`): título "Dades client" subrayado + nom, NIF, adreça,
 * codi postal + població, i província. Primitivas react-pdf inyectadas en `kit`.
 * Reutilizable por presupuesto y factura (6.3).
 */
import type { ClienteDocumento } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface BloqueClienteProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  cliente: ClienteDocumento;
}

/** Une nombre y apellidos ignorando los nulos. */
const nombreCompleto = (cliente: ClienteDocumento): string =>
  [cliente.nombre, cliente.apellidos].filter((parte) => parte).join(' ');

/** Une código postal y población en una línea, ignorando nulos. */
const lineaPoblacion = (cliente: ClienteDocumento): string =>
  [cliente.codigoPostal, cliente.poblacion].filter((parte) => parte).join(' ');

export const BloqueCliente = ({ kit, estilos, cliente }: BloqueClienteProps) => {
  const { View, Text } = kit;
  const poblacion = lineaPoblacion(cliente);
  return (
    <View>
      <Text style={estilos.clienteTitulo}>Dades client</Text>
      <Text style={estilos.linea}>{nombreCompleto(cliente)}</Text>
      {cliente.dniNif ? <Text style={estilos.linea}>{cliente.dniNif}</Text> : null}
      {cliente.direccion ? <Text style={estilos.linea}>{cliente.direccion}</Text> : null}
      {poblacion ? <Text style={estilos.linea}>{poblacion}</Text> : null}
      {cliente.provincia ? <Text style={estilos.linea}>{cliente.provincia}</Text> : null}
    </View>
  );
};
