/**
 * Pie bancario del documento: pie CENTRADO con la frase de formalización + IBAN
 * centrado (épico #6, 6.1b; REDISEÑADO en 6.5 fiel a `P2026023`). Solo se compone
 * en la variante CON IVA. El pie legal es un elemento PROPIO del layout (se pinta
 * SIEMPRE, desacoplado de este bloque). Mantiene el rótulo "Dades bancàries" como
 * marcador semántico del bloque bancario. Primitivas react-pdf inyectadas en `kit`.
 * Reutilizable por factura (6.3).
 */
import type { EtiquetasDocumento } from '../etiquetas-por-idioma';
import type { PieBancarioModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface PieBancarioProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  pieBancario: PieBancarioModelo;
  /**
   * Etiquetas fijas por idioma (frases del pie bancario). La FACTURA reutiliza este
   * bloque en idioma fijo `ca` (design.md D6): recibe las etiquetas catalanas.
   */
  etiquetas: EtiquetasDocumento;
  /** Email de contacto del emisor (de la cabecera) al que enviar el comprovant. */
  email: string;
}

export const PieBancario = ({
  kit,
  estilos,
  pieBancario,
  etiquetas,
  email,
}: PieBancarioProps) => {
  const { View, Text } = kit;
  return (
    <View style={estilos.pieCentrado}>
      <Text style={estilos.pieLinea}>
        {`${etiquetas.formalitzarPagament} "${email}".`}
      </Text>
      <Text style={estilos.pieLinea}>{etiquetas.transferenciaCompte}</Text>
      <Text style={estilos.pieIban}>{pieBancario.iban}</Text>
      <Text style={[estilos.pieLinea, estilos.negrita, { marginTop: 6 }]}>
        {`${etiquetas.dadesBancaries} ${pieBancario.beneficiario}`}
      </Text>
    </View>
  );
};
