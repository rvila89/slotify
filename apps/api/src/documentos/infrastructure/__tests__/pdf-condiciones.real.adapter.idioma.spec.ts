/**
 * TESTS del ADAPTADOR REAL de PDF de "Condicions particulars" `PdfCondicionesRealAdapter`
 * — MEJORA A (change `condiciones-idioma-e2-firma-banner`), fase TDD RED.
 *
 * Trazabilidad: proposal §"Mejora A — Idioma correcto en el PDF de condiciones"; spec-delta
 * `documentos` (MODIFIED `GenerarPdfCondicionesPort` y `PdfCondicionesRealAdapter` para idioma).
 *
 * Contexto: hoy `GenerarPdfCondicionesPort.generar` solo acepta `{ tenantId }` y la clave de
 * almacenamiento es FIJA `condiciones/{tenantId}.pdf` (idéntica para `es` y `ca`), por lo que
 * dos reservas del mismo tenant con idiomas distintos reutilizarían el mismo PDF. La Mejora A
 * añade `idioma: 'es' | 'ca'` al `params` y diferencia la clave: `condiciones/{tenantId}-{idioma}.pdf`;
 * el `idioma` se pasa además al renderizador para seleccionar el texto del JSON bilingüe.
 *
 * Se ejercita el adaptador con DOBLES de los puertos inyectados (config service, almacén y
 * renderizador como función fake) — NO instancia react-pdf ni toca Prisma (hexagonal,
 * hook `no-infra-in-domain`).
 *
 * RED: la firma actual del port/adaptador es `generar({ tenantId })`; pasar `{ tenantId, idioma }`
 * dispara error de tipos (TS) y la clave no incluye el sufijo `-{idioma}` → los asserts FALLAN.
 * GREEN es de `backend-developer`.
 */
import { PdfCondicionesRealAdapter } from '../pdf-condiciones.real.adapter';
import type { ObtenerConfiguracionDocumentoService } from '../../application/obtener-configuracion-documento.service';
import type { AlmacenDocumentosPort } from '../../domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Config del tenant CON secciones (para llegar al render + subida; sin secciones degrada a null). */
const config = (): ConfiguracionDocumentoTenant => ({
  tenantId: TENANT,
  branding: { logoUrl: null, colorPrimario: '#1A1A1A', colorTexto: '#333333' },
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
    plantillaConceptoFiscal: {
      ca: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
      es: 'Gestión del uso del espacio de {nombreComercial} para evento',
    },
    validesaTexto: { ca: '10 DIES', es: '10 DÍAS' },
    pieLegal: { ca: 'Validesa 10 dies.', es: 'Validez 10 días.' },
  },
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [
      {
        titulo: { ca: 'Reserva', es: 'Reserva' },
        cuerpo: { ca: 'El pagament...', es: 'El pago...' },
      },
    ],
  },
});

// --- Dobles de los puertos --------------------------------------------------

const configServiceQueDevuelve = (
  valor: ConfiguracionDocumentoTenant | null,
): ObtenerConfiguracionDocumentoService =>
  ({ ejecutar: jest.fn(async () => valor) } as unknown as ObtenerConfiguracionDocumentoService);

const almacenFalso = (): jest.Mocked<AlmacenDocumentosPort> => ({
  subir: jest.fn(async (_bytes: Uint8Array, clave: string) => `https://storage.local/${clave}`),
  obtener: jest.fn(async (_clave: string) => null),
  urlPublica: jest.fn((clave: string) => `https://storage.local/${clave}`),
});

/** Renderizador doble: no instancia react-pdf; devuelve bytes de PDF simulados. */
const renderFalso = () =>
  jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

// ===========================================================================
// MEJORA A — la clave de almacenamiento se diferencia por idioma:
//   `condiciones/{tenantId}-{idioma}.pdf`.
// ===========================================================================

describe('PdfCondicionesRealAdapter — clave diferenciada por idioma (Mejora A)', () => {
  it('debe_usar_la_clave_condiciones_tenant_es_pdf_cuando_idioma_es_es', async () => {
    // Arrange
    const almacen = almacenFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(config()),
      almacen,
      renderFalso(),
    );

    // Act
    const url = await adaptador.generar({ tenantId: TENANT, idioma: 'es' });

    // Assert — la clave incluye el sufijo `-es`.
    expect(almacen.subir).toHaveBeenCalledTimes(1);
    const [, clave] = almacen.subir.mock.calls[0];
    expect(clave).toBe(`condiciones/${TENANT}-es.pdf`);
    expect(url).toBe(`https://storage.local/condiciones/${TENANT}-es.pdf`);
  });

  it('debe_usar_la_clave_condiciones_tenant_ca_pdf_cuando_idioma_es_ca', async () => {
    // Arrange
    const almacen = almacenFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(config()),
      almacen,
      renderFalso(),
    );

    // Act
    const url = await adaptador.generar({ tenantId: TENANT, idioma: 'ca' });

    // Assert — la clave incluye el sufijo `-ca` y NO colisiona con la de `es`.
    expect(almacen.subir).toHaveBeenCalledTimes(1);
    const [, clave] = almacen.subir.mock.calls[0];
    expect(clave).toBe(`condiciones/${TENANT}-ca.pdf`);
    expect(url).toBe(`https://storage.local/condiciones/${TENANT}-ca.pdf`);
  });

  it('debe_generar_claves_distintas_para_es_y_ca_del_mismo_tenant', async () => {
    // Dos idiomas del mismo tenant NO deben compartir clave (regresión del bug de reuso).
    const almacenEs = almacenFalso();
    const almacenCa = almacenFalso();
    await new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(config()),
      almacenEs,
      renderFalso(),
    ).generar({ tenantId: TENANT, idioma: 'es' });
    await new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(config()),
      almacenCa,
      renderFalso(),
    ).generar({ tenantId: TENANT, idioma: 'ca' });

    const claveEs = almacenEs.subir.mock.calls[0][1];
    const claveCa = almacenCa.subir.mock.calls[0][1];
    expect(claveEs).not.toBe(claveCa);
  });

  it('debe_pasar_el_idioma_al_renderizador_para_seleccionar_el_texto_bilingue', async () => {
    // El renderizador recibe el idioma (además de la config) para elegir titulo/cuerpo.
    const render = renderFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(config()),
      almacenFalso(),
      render,
    );

    await adaptador.generar({ tenantId: TENANT, idioma: 'es' });

    expect(render).toHaveBeenCalledTimes(1);
    // El idioma viaja al render: como 2º argumento o embebido en el 1º (config).
    const args = render.mock.calls[0] as unknown[];
    const contieneIdioma =
      args.some((a) => a === 'es') ||
      args.some(
        (a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>).idioma === 'es',
      );
    expect(contieneIdioma).toBe(true);
  });
});
