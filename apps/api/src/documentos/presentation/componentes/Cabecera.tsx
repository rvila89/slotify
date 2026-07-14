/**
 * Cabecera del documento (épico #6, 6.1b). N3: solo-texto cuando no hay logo del
 * tenant; con logo cuando `logoUrl` está presente. Contenido 100% de la config.
 * Las primitivas react-pdf llegan inyectadas en `kit` (no se importan estáticamente).
 * Reutilizable por presupuesto y factura (6.3).
 */
import type { CabeceraModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

export interface CabeceraProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  cabecera: CabeceraModelo;
}

export const Cabecera = ({ kit, estilos, cabecera }: CabeceraProps) => {
  const { View, Text, Image } = kit;
  return (
    <View style={[estilos.cabecera, { borderBottomColor: cabecera.colorPrimario }]}>
      <View>
        <Text style={[estilos.cabeceraTitulo, { color: cabecera.colorPrimario }]}>
          {cabecera.nombreComercial}
        </Text>
        <Text style={estilos.cabeceraLinea}>{cabecera.razonSocialFiscal}</Text>
        <Text style={estilos.cabeceraLinea}>NIF: {cabecera.nif}</Text>
        <Text style={estilos.cabeceraLinea}>{cabecera.direccionFiscal}</Text>
        <Text style={estilos.cabeceraLinea}>{cabecera.web}</Text>
        <Text style={estilos.cabeceraLinea}>{cabecera.email}</Text>
      </View>
      {cabecera.soloTexto || cabecera.logoUrl === null ? null : (
        <Image style={estilos.cabeceraLogo} src={cabecera.logoUrl} />
      )}
    </View>
  );
};
