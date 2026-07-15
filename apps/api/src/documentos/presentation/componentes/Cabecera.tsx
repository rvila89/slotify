/**
 * Cabecera del documento (épico #6, 6.1b; REDISEÑADA en 6.5 fiel a `P2026023`):
 * logo arriba-izquierda + identidad fiscal arriba-derecha (2 columnas). N3:
 * solo-texto cuando no hay logo del tenant (se pinta el nombre comercial en su
 * lugar). El logo llega como data-URI (bytes del almacén, 6.5), no como URL remota.
 * Contenido 100% de la config. Las primitivas react-pdf llegan inyectadas en `kit`.
 * Reutilizable por presupuesto, factura y condicions.
 */
import type { CabeceraModelo } from '../modelo-documento-presupuesto';
import type { EstilosReactPdf, KitReactPdf } from '../kit-react-pdf';

export interface CabeceraProps {
  kit: KitReactPdf;
  estilos: EstilosReactPdf;
  cabecera: CabeceraModelo;
}

export const Cabecera = ({ kit, estilos, cabecera }: CabeceraProps) => {
  const { View, Text, Image } = kit;
  const conLogo = !cabecera.soloTexto && cabecera.logoUrl !== null;
  return (
    <View style={estilos.cabecera}>
      {conLogo ? (
        <Image style={estilos.cabeceraLogo} src={cabecera.logoUrl} />
      ) : (
        <Text style={[estilos.cabeceraTitulo, { color: cabecera.colorPrimario }]}>
          {cabecera.nombreComercial}
        </Text>
      )}
      <View style={estilos.cabeceraIdentidad}>
        <Text style={estilos.cabeceraLinea}>{cabecera.direccionFiscal}</Text>
        {cabecera.mostrarIdentidadFiscal ? (
          <>
            <Text style={estilos.cabeceraLinea}>{cabecera.razonSocialFiscal}</Text>
            <Text style={estilos.cabeceraLinea}>{cabecera.nif}</Text>
          </>
        ) : null}
        <Text style={estilos.cabeceraLinea}>{cabecera.email}</Text>
        <Text style={estilos.cabeceraEnlace}>{cabecera.web}</Text>
      </View>
    </View>
  );
};
