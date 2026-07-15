/**
 * Pie bancario del documento: pie CENTRADO con la frase de formalización + IBAN
 * centrado (épico #6, 6.1b; REDISEÑADO en 6.5 fiel a `P2026023`). Solo se compone
 * en la variante CON IVA. El pie legal es un elemento PROPIO del layout (se pinta
 * SIEMPRE, desacoplado de este bloque). Mantiene el rótulo "Dades bancàries" como
 * marcador semántico del bloque bancario. Primitivas react-pdf inyectadas en `kit`.
 * Reutilizable por factura (6.3).
 */
import type { PieBancarioModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface PieBancarioProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  pieBancario: PieBancarioModelo;
  /** Email de contacto del emisor (de la cabecera) al que enviar el comprovant. */
  email: string;
}

export const PieBancario = ({ kit, estilos, pieBancario, email }: PieBancarioProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.pieCentrado}>
      <Text style={estilos.pieLinea}>
        *Per formalitzar el pagament, envieu el comprovant a &quot;{email}&quot;.
      </Text>
      <Text style={estilos.pieLinea}>
        El pagament es pot efectuar mitjançant transferència al núm. de compte:
      </Text>
      <Text style={estilos.pieIban}>{pieBancario.iban}</Text>
      <Text style={[estilos.pieLinea, estilos.negrita, { marginTop: 6 }]}>
        Dades bancàries: {pieBancario.beneficiario}
      </Text>
    </View>
  );
};
