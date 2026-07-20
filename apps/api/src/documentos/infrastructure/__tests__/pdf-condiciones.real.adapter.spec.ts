/**
 * TESTS del ADAPTADOR REAL de PDF de "Condicions particulars"
 * `PdfCondicionesRealAdapter` (épico #6, rebanada 6.4a
 * `documentos-condiciones-particulares-pdf`) — fase TDD RED. tasks.md Fase 2: 2.5.
 *
 * Trazabilidad: design.md §"Puerto + adapters de generación" (espejo de
 * `PdfPresupuestoRealAdapter` de 6.1b) y §Cuestión abierta D3 (degradar a `null` si
 * la config es `null` O si `condiciones.secciones` está vacío).
 *
 * El adaptador es INFRAESTRUCTURA de `documentos` que implementa el puerto de dominio
 * `GenerarPdfCondicionesPort` (firma `(params:{tenantId}) => Promise<string|null>`,
 * token `GENERAR_PDF_CONDICIONES_PORT`). Se ejercita con DOBLES:
 *   - doble de `ObtenerConfiguracionDocumentoService` (config del tenant o null),
 *   - doble de `AlmacenDocumentosPort` (`subir`/`urlPublica`),
 *   - doble del renderizador (evita instanciar react-pdf en el test del adaptador).
 * Sin tocar Prisma ni react-pdf (hexagonal, hook `no-infra-in-domain`).
 *
 * Comportamiento (design.md §Flujo + D3):
 *   (a) config `null`                       → `null`, sin renderizar ni subir.
 *   (b) config con `secciones` VACÍAS        → `null`, sin renderizar ni subir (D3).
 *   (c) config con secciones                 → render → `subir(bytes, clave)` → URL.
 *   (d) la clave AÍSLA por tenant: `condiciones/{tenantId}.pdf` (dos tenants → dos
 *       claves distintas).
 *
 * RED: aún NO existe `documentos/infrastructure/pdf-condiciones.real.adapter.ts`. El
 * import falla (TS2307) → batería en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import { PdfCondicionesRealAdapter } from '../pdf-condiciones.real.adapter';
import type { ObtenerConfiguracionDocumentoService } from '../../application/obtener-configuracion-documento.service';
import type { AlmacenDocumentosPort } from '../../domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

const base = (tenantId: string): Omit<ConfiguracionDocumentoTenant, 'condiciones'> => ({
  tenantId,
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
});

const configConSecciones = (tenantId: string = TENANT): ConfiguracionDocumentoTenant => ({
  ...base(tenantId),
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [
      {
        titulo: { ca: 'Reserva i pagament', es: 'Reserva y pago' },
        cuerpo: { ca: 'Cos.', es: 'Cuerpo.' },
      },
    ],
  },
});

const configSinSecciones = (tenantId: string = TENANT): ConfiguracionDocumentoTenant => ({
  ...base(tenantId),
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: [],
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

/** Renderizador doble: no instancia react-pdf, devuelve bytes de PDF simulados. */
const renderFalso = () =>
  jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

// ===========================================================================
// 2.5 (a) — Degradado: config null → null, sin renderizar ni subir.
// ===========================================================================

describe('PdfCondicionesRealAdapter — degradado sin config (2.5a)', () => {
  it('debe_devolver_null_cuando_el_tenant_no_tiene_configuracion_de_documento', async () => {
    // Arrange
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(null),
      almacen,
      render,
    );

    // Act
    const url = await adaptador.generar({ tenantId: TENANT });

    // Assert — degrada: null y sin efectos de render/subida.
    expect(url).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(almacen.subir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2.5 (b) — Degradado D3: config presente pero secciones VACÍAS → null.
// ===========================================================================

describe('PdfCondicionesRealAdapter — degradado con secciones vacías (2.5b, D3)', () => {
  it('debe_devolver_null_cuando_condiciones_secciones_esta_vacio', async () => {
    // Arrange
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(configSinSecciones()),
      almacen,
      render,
    );

    // Act
    const url = await adaptador.generar({ tenantId: TENANT });

    // Assert — D3: sin secciones no se genera documento (no se adjunta).
    expect(url).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(almacen.subir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2.5 (c) — Camino feliz: renderiza, sube con clave por tenant, devuelve URL.
// ===========================================================================

describe('PdfCondicionesRealAdapter — camino feliz (2.5c)', () => {
  it('debe_renderizar_con_la_config_del_tenant_subir_los_bytes_y_devolver_la_url', async () => {
    // Arrange
    const cfg = configConSecciones();
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(cfg),
      almacen,
      render,
    );

    // Act
    const url = await adaptador.generar({ tenantId: TENANT });

    // Assert — render con la config del tenant; subida con la clave del tenant.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(cfg);
    expect(almacen.subir).toHaveBeenCalledTimes(1);
    const [, clave] = almacen.subir.mock.calls[0];
    expect(clave).toBe(`condiciones/${TENANT}.pdf`);
    expect(url).toBe(`https://storage.local/condiciones/${TENANT}.pdf`);
  });
});

// ===========================================================================
// 2.5 (d) — La clave AÍSLA por tenant: dos tenants → dos claves distintas.
// ===========================================================================

describe('PdfCondicionesRealAdapter — la clave aísla por tenant (2.5d)', () => {
  it('debe_generar_claves_distintas_para_tenants_distintos', async () => {
    // Arrange
    const almacenA = almacenFalso();
    const almacenB = almacenFalso();
    const adaptadorA = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(configConSecciones(TENANT)),
      almacenA,
      renderFalso(),
    );
    const adaptadorB = new PdfCondicionesRealAdapter(
      configServiceQueDevuelve(configConSecciones(OTRO_TENANT)),
      almacenB,
      renderFalso(),
    );

    // Act
    await adaptadorA.generar({ tenantId: TENANT });
    await adaptadorB.generar({ tenantId: OTRO_TENANT });

    // Assert — cada tenant escribe en su propia clave.
    const claveA = almacenA.subir.mock.calls[0][1];
    const claveB = almacenB.subir.mock.calls[0][1];
    expect(claveA).toBe(`condiciones/${TENANT}.pdf`);
    expect(claveB).toBe(`condiciones/${OTRO_TENANT}.pdf`);
    expect(claveA).not.toBe(claveB);
  });
});
