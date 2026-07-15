/**
 * Resolución del LOGO del tenant a un data-URI para el render react-pdf (épico #6,
 * rebanada 6.5 `documentos-rediseno-pdf-logo-storage`) — capa de presentación de
 * `documentos`.
 *
 * DECISIÓN (design.md §B): el logo NO se carga por auto-request HTTP durante el
 * render (frágil: exige server escuchando + red). En su lugar, el render resuelve
 * los BYTES del logo desde `AlmacenDocumentosPort.obtener(clave)` y los pasa a la
 * `<Image src>` de react-pdf como un data-URI (`data:image/jpeg;base64,…`), que
 * react-pdf acepta. Si el logo no se resuelve (sin almacén, sin `logoUrl`, o clave
 * inexistente) → `logoUrl = null` → cabecera solo-texto (sin romper el render).
 *
 * Determinista y sin react-pdf. `config` es INMUTABLE: se devuelve una copia con el
 * `branding.logoUrl` sustituido por el data-URI (o `null`), nunca se muta la entrada.
 */
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';
import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';
import type { CabeceraModelo } from './modelo-documento-presupuesto';

/** Marcador de la ruta estática del almacén (serveRoot `/almacen`, design.md §A). */
const SEGMENTO_ALMACEN = '/almacen/';

/**
 * Deriva la CLAVE del objeto en el almacén desde la `logoUrl` pública (inverso de
 * `urlPublica`). Toma lo que sigue al segmento `/almacen/`; si la URL no lo contiene
 * (formato inesperado), cae a la clave convencional por tenant `logos/{tenantId}.jpg`.
 */
export const derivarClaveLogo = (
  logoUrl: string,
  tenantId: string | null,
): string | null => {
  const indice = logoUrl.indexOf(SEGMENTO_ALMACEN);
  if (indice === -1) {
    return tenantId === null ? null : `logos/${tenantId}.jpg`;
  }
  return logoUrl.slice(indice + SEGMENTO_ALMACEN.length);
};

/** Compone el data-URI JPEG a partir de los bytes del logo. */
const aDataUriJpeg = (bytes: Uint8Array): string =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;

/**
 * Devuelve una COPIA de `config` con `branding.logoUrl` resuelto a un data-URI con
 * los bytes del logo leídos del almacén; o `null` si no hay almacén, no hay `logoUrl`
 * configurado, o la clave no existe (→ cabecera solo-texto). No muta la entrada.
 */
export const resolverConfigConLogoDataUri = async (
  config: ConfiguracionDocumentoTenant,
  almacen: AlmacenDocumentosPort | undefined,
): Promise<ConfiguracionDocumentoTenant> => {
  const logoUrl = config.branding.logoUrl;
  if (almacen === undefined || logoUrl === null) {
    return config;
  }
  const clave = derivarClaveLogo(logoUrl, config.tenantId);
  const bytes = clave === null ? null : await almacen.obtener(clave);
  return {
    ...config,
    branding: {
      ...config.branding,
      logoUrl: bytes === null ? null : aDataUriJpeg(bytes),
    },
  };
};

/**
 * Devuelve una COPIA de una `CabeceraModelo` con `logoUrl` resuelto a data-URI desde
 * el almacén (usado por la FACTURA, que renderiza a partir del modelo ya construido).
 * `soloTexto` se recalcula según el resultado. Sin almacén / sin logo / clave
 * inexistente → `logoUrl = null` + `soloTexto = true`. No muta la entrada.
 */
export const resolverCabeceraConLogoDataUri = async (
  cabecera: CabeceraModelo,
  almacen: AlmacenDocumentosPort | undefined,
): Promise<CabeceraModelo> => {
  if (almacen === undefined || cabecera.logoUrl === null) {
    return cabecera;
  }
  const clave = derivarClaveLogo(cabecera.logoUrl, null);
  const bytes = clave === null ? null : await almacen.obtener(clave);
  const logoUrl = bytes === null ? null : aDataUriJpeg(bytes);
  return { ...cabecera, logoUrl, soloTexto: logoUrl === null };
};
