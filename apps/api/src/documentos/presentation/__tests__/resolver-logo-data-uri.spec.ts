/**
 * TESTS del resolutor del LOGO a data-URI para el render (épico #6, rebanada 6.5
 * `documentos-rediseno-pdf-logo-storage`). tasks.md Fase 2: 2.5 (cabecera por bytes).
 *
 * Trazabilidad: design.md §B (decisión gate): el logo se carga por BYTES/data-URI
 * desde `AlmacenDocumentosPort.obtener(clave)`, NO por auto-request HTTP. Sin almacén /
 * sin `logoUrl` / clave inexistente → `logoUrl = null` (cabecera solo-texto), sin
 * romper el render. Determinista y sin react-pdf.
 */
import type { AlmacenDocumentosPort } from '../../domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';
import {
  derivarClaveLogo,
  resolverCabeceraConLogoDataUri,
  resolverConfigConLogoDataUri,
} from '../resolver-logo-data-uri';
import type { CabeceraModelo } from '../modelo-documento-presupuesto';

const TENANT = '00000000-0000-0000-0000-000000000001';
const LOGO_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG mágico

/** Almacén falso que sirve bytes solo para las claves que se le siembran. */
const almacenConLogo = (claves: Record<string, Uint8Array>): AlmacenDocumentosPort => ({
  subir: async (_bytes, clave) => `http://localhost:3000/almacen/${clave}`,
  obtener: async (clave) => claves[clave] ?? null,
  urlPublica: (clave) => `http://localhost:3000/almacen/${clave}`,
});

const configConLogoUrl = (logoUrl: string | null): ConfiguracionDocumentoTenant => ({
  tenantId: TENANT,
  branding: { logoUrl, colorPrimario: '#5edada', colorTexto: '#333333' },
  identidadFiscal: {
    razonSocialFiscal: 'Canoliart, SL',
    nombreComercial: "Masia l'Encís",
    nif: 'B10874287',
    direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
    web: 'www.masialencis.com',
    email: 'info@masialencis.com',
  },
  banca: {
    iban: 'ES30 0182 1683 4002 0172 9599',
    beneficiarioTransferencia: 'Canoliart, SL',
    conceptoTransferencia: "Masia l'Encís",
  },
  textos: {
    plantillaConceptoFiscal: 'Gestió ús espai de {nombreComercial} per esdeveniment',
    validesaTexto: '10 DIES',
    pieLegal: 'Validesa 10 dies.',
  },
  condiciones: { titulo: 'Condicions Particulars', secciones: [] },
});

const CLAVE_LOGO = `logos/${TENANT}.jpg`;
const URL_LOGO = `http://localhost:3000/almacen/${CLAVE_LOGO}`;

describe('derivarClaveLogo — clave del objeto desde la logoUrl pública (2.5)', () => {
  it('debe_derivar_la_clave_quitando_el_prefijo_publico_almacen', () => {
    expect(derivarClaveLogo(URL_LOGO, TENANT)).toBe(CLAVE_LOGO);
  });

  it('debe_caer_a_la_clave_convencional_por_tenant_si_la_url_no_es_del_almacen', () => {
    expect(derivarClaveLogo('https://cdn.ajeno/logo.jpg', TENANT)).toBe(CLAVE_LOGO);
  });

  it('debe_devolver_null_si_la_url_no_es_del_almacen_y_no_hay_tenantId', () => {
    expect(derivarClaveLogo('https://cdn.ajeno/logo.jpg', null)).toBeNull();
  });
});

describe('resolverConfigConLogoDataUri — logo por bytes/data-URI (2.5)', () => {
  it('debe_sustituir_logoUrl_por_un_data_uri_jpeg_con_los_bytes_del_almacen', async () => {
    const config = configConLogoUrl(URL_LOGO);
    const almacen = almacenConLogo({ [CLAVE_LOGO]: LOGO_BYTES });

    const resuelta = await resolverConfigConLogoDataUri(config, almacen);

    const esperado = `data:image/jpeg;base64,${Buffer.from(LOGO_BYTES).toString('base64')}`;
    expect(resuelta.branding.logoUrl).toBe(esperado);
    // No es una URL remota: es un data-URI (bytes embebidos), no auto-request HTTP.
    expect(resuelta.branding.logoUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('debe_dejar_logoUrl_null_cuando_la_clave_no_existe_en_el_almacen', async () => {
    const config = configConLogoUrl(URL_LOGO);
    const almacen = almacenConLogo({}); // sin el logo sembrado

    const resuelta = await resolverConfigConLogoDataUri(config, almacen);

    expect(resuelta.branding.logoUrl).toBeNull();
  });

  it('debe_dejar_la_config_intacta_cuando_no_hay_almacen', async () => {
    const config = configConLogoUrl(URL_LOGO);

    const resuelta = await resolverConfigConLogoDataUri(config, undefined);

    expect(resuelta.branding.logoUrl).toBe(URL_LOGO);
  });

  it('debe_dejar_logoUrl_null_cuando_la_config_no_tiene_logo', async () => {
    const config = configConLogoUrl(null);
    const almacen = almacenConLogo({ [CLAVE_LOGO]: LOGO_BYTES });

    const resuelta = await resolverConfigConLogoDataUri(config, almacen);

    expect(resuelta.branding.logoUrl).toBeNull();
  });

  it('no_debe_mutar_la_config_de_entrada', async () => {
    const config = configConLogoUrl(URL_LOGO);
    const almacen = almacenConLogo({ [CLAVE_LOGO]: LOGO_BYTES });

    await resolverConfigConLogoDataUri(config, almacen);

    expect(config.branding.logoUrl).toBe(URL_LOGO);
  });
});

describe('resolverCabeceraConLogoDataUri — logo de la cabecera (factura) (2.5)', () => {
  const cabecera = (logoUrl: string | null): CabeceraModelo => ({
    soloTexto: logoUrl === null,
    mostrarIdentidadFiscal: true,
    logoUrl,
    colorPrimario: '#5edada',
    colorTexto: '#333333',
    razonSocialFiscal: 'Canoliart, SL',
    nombreComercial: "Masia l'Encís",
    nif: 'B10874287',
    direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
    web: 'www.masialencis.com',
    email: 'info@masialencis.com',
  });

  it('debe_resolver_el_logo_a_data_uri_y_marcar_soloTexto_false', async () => {
    const almacen = almacenConLogo({ [CLAVE_LOGO]: LOGO_BYTES });

    const resuelta = await resolverCabeceraConLogoDataUri(cabecera(URL_LOGO), almacen);

    expect(resuelta.logoUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(resuelta.soloTexto).toBe(false);
  });

  it('debe_caer_a_solo_texto_cuando_el_logo_no_existe', async () => {
    const almacen = almacenConLogo({});

    const resuelta = await resolverCabeceraConLogoDataUri(cabecera(URL_LOGO), almacen);

    expect(resuelta.logoUrl).toBeNull();
    expect(resuelta.soloTexto).toBe(true);
  });
});
