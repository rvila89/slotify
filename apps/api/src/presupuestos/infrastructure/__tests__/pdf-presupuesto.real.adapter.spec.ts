/**
 * TESTS del ADAPTADOR REAL de PDF del presupuesto `PdfPresupuestoRealAdapter`
 * (épico #6, rebanada 6.1b `documentos-presupuesto-pdf-con-iva`) — fase TDD RED.
 * tasks.md Fase 2: 2.3.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirement "PDF real del presupuesto CON
 * IVA (sustituye al fake)"; escenarios "El presupuesto genera un PDF real y devuelve
 * su URL", "Un fallo de render/subida no revierte la pre_reserva"), spec-delta
 * `documentos` (Requirement "El PDF se persiste vía el puerto de almacén de
 * documentos"; escenario "El PDF generado se sube por el puerto de almacén" con clave
 * que incluye el `tenant_id`), design.md §"Flujo del adaptador real".
 *
 * El adaptador es INFRAESTRUCTURA de `presupuestos` que implementa el puerto de dominio
 * `GenerarPdfPresupuestoPort` (firma `(params:{tenantId,reservaId,idPresupuesto}) =>
 * Promise<string|null>`, token `GENERAR_PDF_PRESUPUESTO_PORT`). Se ejercita con DOBLES:
 *   - doble de `ObtenerConfiguracionDocumentoService` (config del tenant o null),
 *   - doble de `AlmacenDocumentosPort` (`subir`/`urlPublica`),
 *   - doble del puerto de lectura de datos del documento,
 *   - doble del renderizador (evita instanciar react-pdf en el test del adaptador).
 * Sin tocar Prisma ni la BD (hexagonal, hook `no-infra-in-domain`).
 *
 * Camino DEGRADADO (N1/design.md): config `null` → devuelve `null` sin subir ni
 * renderizar (no revienta el post-commit). Camino FELIZ: renderiza, sube por
 * `subir(bytes, clave)` con clave que incluye el `tenant_id`, y devuelve la URL.
 *
 * RED: aún NO existe `presupuestos/infrastructure/pdf-presupuesto.real.adapter.ts`. El
 * import falla (TS2307) y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import { PdfPresupuestoRealAdapter } from '../pdf-presupuesto.real.adapter';
import type { ObtenerConfiguracionDocumentoService } from '../../../documentos/application/obtener-configuracion-documento.service';
import type { AlmacenDocumentosPort } from '../../../documentos/domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../../../documentos/domain/configuracion-documento';
import type {
  CargarDatosDocumentoPresupuestoPort,
  DatosDocumentoPresupuestoCargados,
} from '../pdf-presupuesto.real.adapter';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-2b';
const ID_PRESUPUESTO = 'presu-1';

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
    plantillaConceptoFiscal: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    validesaTexto: '10 DIES',
    pieLegal: 'Validesa 10 dies.',
  },
});

const datosCargados = (): DatosDocumentoPresupuestoCargados => ({
  numeroPresupuesto: '2026001',
  fecha: new Date('2026-07-13T00:00:00.000Z'),
  cliente: {
    nombre: 'Anna',
    apellidos: 'Puig Soler',
    dniNif: '47123456Z',
    direccion: 'Carrer Major, 12',
    codigoPostal: '08720',
    poblacion: 'Vilafranca del Penedès',
    provincia: 'Barcelona',
  },
  fechaEvento: new Date('2027-09-12T00:00:00.000Z'),
  duracionHoras: 8,
  numPersonas: 80,
  extras: [{ descripcion: 'Neteja', importeEur: '100.00' }],
  desglose: {
    baseImponible: '4132.23',
    ivaPorcentaje: '21.00',
    ivaImporte: '867.77',
    total: '5000.00',
  },
  reparto: { senalEur: '2000.00', liquidacionEur: '3000.00', fianzaEur: '300.00' },
});

// --- Dobles de los puertos --------------------------------------------------

const configServiceQueDevuelve = (
  valor: ConfiguracionDocumentoTenant | null,
): ObtenerConfiguracionDocumentoService =>
  ({ ejecutar: jest.fn(async () => valor) } as unknown as ObtenerConfiguracionDocumentoService);

const cargarDatosQueDevuelve = (
  valor: DatosDocumentoPresupuestoCargados | null,
): CargarDatosDocumentoPresupuestoPort => ({ ejecutar: jest.fn(async () => valor) });

const almacenFalso = (): jest.Mocked<AlmacenDocumentosPort> => ({
  subir: jest.fn(async (_bytes: Uint8Array, clave: string) => `https://storage.local/${clave}`),
  urlPublica: jest.fn((clave: string) => `https://storage.local/${clave}`),
});

/** Renderizador doble: no instancia react-pdf, devuelve bytes de PDF simulados. */
const renderFalso = () =>
  jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

// ===========================================================================
// 2.3 — Degradado: config null → null, sin renderizar ni subir.
// ===========================================================================

describe('PdfPresupuestoRealAdapter — degradado sin config (2.3)', () => {
  it('debe_devolver_null_cuando_el_tenant_no_tiene_configuracion_de_documento', async () => {
    // Arrange
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfPresupuestoRealAdapter(
      configServiceQueDevuelve(null),
      cargarDatosQueDevuelve(datosCargados()),
      almacen,
      render,
    );

    // Act
    const url = await adaptador.generar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      idPresupuesto: ID_PRESUPUESTO,
    });

    // Assert — degrada como el fake: null y sin efectos de render/subida.
    expect(url).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(almacen.subir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2.3 — Camino feliz: renderiza, sube con clave que incluye el tenant, y devuelve URL.
// ===========================================================================

describe('PdfPresupuestoRealAdapter — camino feliz (2.3)', () => {
  it('debe_subir_los_bytes_con_una_clave_que_incluye_el_tenant_id_y_devolver_la_url', async () => {
    // Arrange
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfPresupuestoRealAdapter(
      configServiceQueDevuelve(config()),
      cargarDatosQueDevuelve(datosCargados()),
      almacen,
      render,
    );

    // Act
    const url = await adaptador.generar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      idPresupuesto: ID_PRESUPUESTO,
    });

    // Assert — se subió con una clave que aísla por tenant y se devolvió la URL real.
    expect(almacen.subir).toHaveBeenCalledTimes(1);
    const [, clave] = almacen.subir.mock.calls[0];
    expect(clave).toContain(TENANT);
    expect(clave).toContain(ID_PRESUPUESTO);
    expect(url).toBe(`https://storage.local/${clave}`);
    // No es la URL sintética del fake.
    expect(url).not.toBe(`https://storage.local/presupuestos/${ID_PRESUPUESTO}.pdf`);
  });

  it('debe_renderizar_con_la_config_del_tenant_y_los_datos_cargados', async () => {
    // Arrange
    const cfg = config();
    const datos = datosCargados();
    const render = renderFalso();
    const adaptador = new PdfPresupuestoRealAdapter(
      configServiceQueDevuelve(cfg),
      cargarDatosQueDevuelve(datos),
      almacenFalso(),
      render,
    );

    // Act
    await adaptador.generar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      idPresupuesto: ID_PRESUPUESTO,
    });

    // Assert — el render recibe config + datos (contenido 100% del tenant).
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(cfg, datos);
  });

  it('debe_devolver_null_si_no_hay_datos_del_presupuesto_para_el_tenant', async () => {
    // Defensa: datos no encontrados (RLS/cross-tenant) → degrada sin romper.
    const almacen = almacenFalso();
    const render = renderFalso();
    const adaptador = new PdfPresupuestoRealAdapter(
      configServiceQueDevuelve(config()),
      cargarDatosQueDevuelve(null),
      almacen,
      render,
    );

    const url = await adaptador.generar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      idPresupuesto: ID_PRESUPUESTO,
    });

    expect(url).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(almacen.subir).not.toHaveBeenCalled();
  });
});
