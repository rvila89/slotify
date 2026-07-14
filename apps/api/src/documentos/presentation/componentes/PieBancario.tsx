/**
 * Pie bancario del documento: dades de la transferència (IBAN + beneficiari + concepte)
 * y pie legal (épico #6, 6.1b). Primitivas react-pdf inyectadas en `kit`. Reutilizable
 * por factura (6.3).
 */
import type { PieBancarioModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

export interface PieBancarioProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  pieBancario: PieBancarioModelo;
  pieLegal: string;
}

export const PieBancario = ({ kit, estilos, pieBancario, pieLegal }: PieBancarioProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.pie}>
      <Text style={estilos.seccionTitulo}>Dades bancàries</Text>
      <Text style={estilos.linea}>
        <Text style={estilos.negrita}>IBAN:</Text> {pieBancario.iban}
      </Text>
      <Text style={estilos.linea}>Beneficiari: {pieBancario.beneficiario}</Text>
      <Text style={estilos.linea}>Concepte: {pieBancario.concepto}</Text>
      <Text style={[estilos.linea, { marginTop: 8 }]}>{pieLegal}</Text>
    </View>
  );
};
