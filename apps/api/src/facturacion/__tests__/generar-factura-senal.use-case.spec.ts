/**
 * TESTS del caso de uso `GenerarFacturaSenalUseCase` (US-022 / UC-18) — fase TDD RED.
 * tasks.md Fase 3: 3.4 (idempotencia), 3.5 (creación borrador + AUDIT_LOG crear),
 * 3.6 (PDF post-commit con datos emisor/receptor + pdf_url idempotente), 3.7 (borrador
 * inválido por datos fiscales del cliente), 3.8 (error transitorio de PDF + reintento).
 *
 * Trazabilidad: US-022, spec-delta `facturacion` (Requirements de generación automática
 * en borrador, desglose fiscal, numeración, idempotencia, generación de PDF con datos
 * fiscales, borrador inválido, error temporal de PDF); design.md §D-1/§D-2/§D-3/§D-4/
 * §D-5/§D-9. Contrato: schema `FacturaSenalDto` (tipo='senal', total=RESERVA.importeSenal,
 * baseImponible, ivaPorcentaje '21.00', ivaImporte, estado, pdfUrl, esBorradorInvalido,
 * pdfPendiente); códigos `DATOS_FISCALES_INCOMPLETOS` (422), `PDF_PENDIENTE` (422).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La numeración concurrente REAL vive en
 * `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN: guarda de idempotencia,
 * desglose fiscal del total congelado, creación en borrador, generación de PDF
 * POST-COMMIT idempotente sobre pdf_url, borrador inválido por datos fiscales del
 * cliente y error transitorio del PDF con reintento, y AUDIT_LOG `crear`.
 *
 * RED: aún NO existe `facturacion/application/generar-factura-senal.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  GenerarFacturaSenalUseCase,
  ReservaNoConfirmadaError,
  type GenerarFacturaSenalDeps,
  type GenerarFacturaSenalComando,
  type ReservaFacturable,
  type ClienteFiscal,
  type TenantFiscal,
  type FacturaSenal,
  type RepositoriosFacturacion,
  type UnidadDeTrabajoFacturacionPort,
  type ClockPort,
} from '../application/generar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FACTURA_ID = 'fac-1';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

/** Forma laxa del input del generador de PDF (para las aserciones del doble). */
interface PdfArg {
  emisor: { nif?: string };
  receptor: { dniNif?: string | null };
  total?: string;
  numeroFactura?: string;
}

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA reserva_confirmada con importe_senal congelado (US-021).
// ---------------------------------------------------------------------------

const reservaConfirmada = (over: Partial<ReservaFacturable> = {}): ReservaFacturable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0001',
  estado: 'reserva_confirmada',
  importeSenal: '1200.00',
  ...over,
});

const clienteCompleto = (over: Partial<ClienteFiscal> = {}): ClienteFiscal => ({
  idCliente: CLIENTE_ID,
  nombre: 'Marta',
  apellidos: 'Soler',
  dniNif: '12345678Z',
  direccion: 'C/ Mayor 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
  ...over,
});

const tenantFiscal = (over: Partial<TenantFiscal> = {}): TenantFiscal => ({
  idTenant: TENANT,
  nombre: 'Finca Los Olivos S.L.',
  nif: 'B12345678',
  iban: 'ES9121000418450200051332',
  direccion: 'Ctra. Nacional 1, km 42',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta la tx de creación + numeración
// y, POST-commit, la generación del PDF (UPDATE idempotente de pdf_url).
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosFacturacion {
  facturas: {
    buscarPorReservaYTipo: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    crear: jest.Mock;
    guardarPdfUrl: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo = 'crear' | 'auditoria';

const crearReposFake = (opciones: {
  facturaExistente?: FacturaSenal | null;
  ultimoNumero?: string | null;
  fallarEn?: PuntoDeFallo;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async () => opciones.facturaExistente ?? null),
    ultimoNumeroDelAnio: jest.fn(async () => opciones.ultimoNumero ?? null),
    crear: jest.fn(async (f: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
      return { idFactura: FACTURA_ID, pdfUrl: null, fechaEmision: null, ...f };
    }),
    guardarPdfUrl: jest.fn(async () => undefined),
  },
  auditoria: {
    registrar: jest.fn(async () => {
      if (opciones.fallarEn === 'auditoria') throw new Error('FALLO_AUDITORIA');
      return undefined;
    }),
  },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoFacturacionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosFacturacion) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaFacturable | null;
  cliente?: ClienteFiscal;
  tenant?: TenantFiscal;
  facturaExistente?: FacturaSenal | null;
  ultimoNumero?: string | null;
  fallarEn?: PuntoDeFallo;
  pdfFalla?: boolean;
  pdfUrl?: string;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaConfirmada();
  const repos = crearReposFake({
    facturaExistente: opciones.facturaExistente,
    ultimoNumero: opciones.ultimoNumero,
    fallarEn: opciones.fallarEn,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const cargarCliente = jest.fn(async () => opciones.cliente ?? clienteCompleto());
  const cargarTenant = jest.fn(async () => opciones.tenant ?? tenantFiscal());
  const generarPdf = jest.fn(async (_params: PdfArg) => {
    if (opciones.pdfFalla) throw new Error('PDF_SERVICE_DOWN');
    return opciones.pdfUrl ?? 'https://storage.local/facturas/fac-1.pdf';
  });
  const deps: GenerarFacturaSenalDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    cargarCliente,
    cargarTenant,
    generarPdf,
    clock: relojFijo,
  };
  return {
    useCase: new GenerarFacturaSenalUseCase(deps),
    repos,
    uow,
    cargarReserva,
    cargarCliente,
    cargarTenant,
    generarPdf,
    deps,
  };
};

const comando = (
  over: Partial<GenerarFacturaSenalComando> = {},
): GenerarFacturaSenalComando => ({
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.5 — Creación en borrador: tipo='senal', estado='borrador', total =
//        RESERVA.importe_senal, reserva_id/tenant_id correctos + desglose fiscal.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — creación de la factura en borrador (3.5)', () => {
  it('debe_crear_una_factura_tipo_senal_en_borrador_con_total_igual_al_importe_senal', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConfirmada({ importeSenal: '1200.00' }),
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.crear).toHaveBeenCalledTimes(1);
    const args = repos.facturas.crear.mock.calls[0][0];
    expect(args.tipo).toBe('senal');
    expect(args.estado).toBe('borrador');
    expect(args.total).toBe('1200.00');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_congelar_el_desglose_fiscal_991_74_base_208_26_iva_para_1200_de_total', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConfirmada({ importeSenal: '1200.00' }),
    });

    await useCase.ejecutar(comando());

    const args = repos.facturas.crear.mock.calls[0][0];
    expect(args.baseImponible).toBe('991.74');
    expect(args.ivaPorcentaje).toBe('21.00');
    expect(args.ivaImporte).toBe('208.26');
    // Invariante contable: base + iva = total EXACTO.
    expect(Number(args.baseImponible) + Number(args.ivaImporte)).toBe(1200);
  });

  it('debe_asignar_el_numero_F_2026_0001_como_primera_del_tenant_en_el_ano', async () => {
    const { useCase, repos } = montar({ ultimoNumero: null });

    await useCase.ejecutar(comando());

    const args = repos.facturas.crear.mock.calls[0][0];
    expect(args.numeroFactura).toBe('F-2026-0001');
  });

  it('debe_derivar_el_siguiente_numero_del_ultimo_del_tenant_en_el_ano', async () => {
    const { useCase, repos } = montar({ ultimoNumero: 'F-2026-0041' });

    await useCase.ejecutar(comando());

    const args = repos.facturas.crear.mock.calls[0][0];
    expect(args.numeroFactura).toBe('F-2026-0042');
  });

  it('debe_registrar_AUDIT_LOG_accion_crear_entidad_FACTURA_con_el_id_de_la_factura', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalled();
    const crear = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear');
    expect(crear).toBeDefined();
    expect(crear.entidad).toBe('FACTURA');
    expect(crear.entidadId).toBe(FACTURA_ID);
  });
});

// ===========================================================================
// Guarda de origen: solo se factura una RESERVA en reserva_confirmada.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — guarda de estado de la reserva', () => {
  const estadosInvalidos: ReadonlyArray<ReservaFacturable['estado']> = [
    'pre_reserva',
    'consulta',
    'reserva_cancelada',
  ];

  it.each(estadosInvalidos)(
    'debe_rechazar_con_ReservaNoConfirmada_cuando_la_reserva_esta_en_%s_sin_crear_factura',
    async (estado) => {
      const { useCase, repos } = montar({ reserva: reservaConfirmada({ estado }) });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ReservaNoConfirmadaError,
      );
      expect(repos.facturas.crear).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 3.4 — Idempotencia: si ya existe FACTURA tipo='senal' para la reserva → NO
//        duplica, devuelve la existente y registra el intento en AUDIT_LOG.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — idempotencia una factura de señal por reserva (3.4)', () => {
  it('debe_devolver_la_factura_existente_sin_crear_un_duplicado', async () => {
    const existente: FacturaSenal = {
      idFactura: 'fac-prev',
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      numeroFactura: 'F-2026-0007',
      tipo: 'senal',
      estado: 'borrador',
      total: '1200.00',
      baseImponible: '991.74',
      ivaPorcentaje: '21.00',
      ivaImporte: '208.26',
      pdfUrl: 'https://storage.local/facturas/fac-prev.pdf',
      fechaEmision: null,
    };
    const { useCase, repos } = montar({ facturaExistente: existente });

    const resultado = await useCase.ejecutar(comando());

    expect(repos.facturas.buscarPorReservaYTipo).toHaveBeenCalledWith(RESERVA_ID, 'senal');
    expect(repos.facturas.crear).not.toHaveBeenCalled();
    expect(resultado.idFactura).toBe('fac-prev');
  });

  it('debe_registrar_en_AUDIT_LOG_el_intento_de_duplicado_cuando_ya_existe', async () => {
    const existente: FacturaSenal = {
      idFactura: 'fac-prev',
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      numeroFactura: 'F-2026-0007',
      tipo: 'senal',
      estado: 'borrador',
      total: '1200.00',
      baseImponible: '991.74',
      ivaPorcentaje: '21.00',
      ivaImporte: '208.26',
      pdfUrl: null,
      fechaEmision: null,
    };
    const { useCase, repos } = montar({ facturaExistente: existente });

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.entidad).toBe('FACTURA');
    expect(args.entidadId).toBe('fac-prev');
  });
});

// ===========================================================================
// 3.6 — PDF POST-COMMIT: tras crear la factura en borrador, se genera el PDF con
//        datos de emisor (TENANT) y receptor (CLIENTE) y se guarda pdf_url
//        (UPDATE idempotente), FUERA de la transacción de creación.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — generación de PDF post-commit (3.6)', () => {
  it('debe_generar_el_pdf_con_datos_de_emisor_tenant_y_receptor_cliente', async () => {
    const { useCase, generarPdf } = montar({
      cliente: clienteCompleto({ dniNif: '99999999R' }),
      tenant: tenantFiscal({ nif: 'B99999999' }),
    });

    await useCase.ejecutar(comando());

    expect(generarPdf).toHaveBeenCalledTimes(1);
    const args = generarPdf.mock.calls[0][0];
    // Emisor (TENANT).
    expect(args.emisor.nif).toBe('B99999999');
    // Receptor (CLIENTE).
    expect(args.receptor.dniNif).toBe('99999999R');
    // Desglose + número presentes en el input del PDF.
    expect(args.total).toBe('1200.00');
    expect(args.numeroFactura).toBe('F-2026-0001');
  });

  it('debe_guardar_la_pdf_url_devuelta_por_el_generador_de_forma_idempotente', async () => {
    const { useCase, repos } = montar({ pdfUrl: 'https://storage.local/facturas/fac-1.pdf' });

    await useCase.ejecutar(comando());

    expect(repos.facturas.guardarPdfUrl).toHaveBeenCalledTimes(1);
    const args = repos.facturas.guardarPdfUrl.mock.calls[0];
    expect(args[0]).toBe(FACTURA_ID);
    expect(args[1]).toBe('https://storage.local/facturas/fac-1.pdf');
  });

  it('debe_generar_el_pdf_DESPUES_de_crear_la_factura_en_la_transaccion', async () => {
    const orden: string[] = [];
    const { useCase, repos, generarPdf } = montar();
    repos.facturas.crear.mockImplementation(async (f: Record<string, unknown>) => {
      orden.push('crear');
      return { idFactura: FACTURA_ID, pdfUrl: null, fechaEmision: null, ...f };
    });
    generarPdf.mockImplementation(async () => {
      orden.push('pdf');
      return 'https://storage.local/facturas/fac-1.pdf';
    });

    await useCase.ejecutar(comando());

    expect(orden.indexOf('pdf')).toBeGreaterThan(orden.indexOf('crear'));
  });
});

// ===========================================================================
// 3.7 — Borrador inválido por datos fiscales del CLIENTE incompletos: NO se
//        genera el PDF (pdf_url = null), la factura queda en borrador marcada
//        inválida y la aprobación queda bloqueada (esBorradorInvalido = true).
// ===========================================================================

describe('GenerarFacturaSenalUseCase — borrador inválido por datos fiscales del cliente (3.7)', () => {
  it.each(['dniNif', 'direccion', 'codigoPostal', 'poblacion', 'provincia'] as const)(
    'debe_dejar_borrador_invalido_sin_pdf_cuando_falta_el_campo_%s_del_cliente',
    async (campo) => {
      const { useCase, repos, generarPdf } = montar({
        cliente: clienteCompleto({ [campo]: null } as Partial<ClienteFiscal>),
      });

      const resultado = await useCase.ejecutar(comando());

      // La factura SÍ se crea en borrador...
      expect(repos.facturas.crear).toHaveBeenCalledTimes(1);
      expect(repos.facturas.crear.mock.calls[0][0].estado).toBe('borrador');
      // ...pero NO se genera el PDF (fallo de datos, no transitorio: no se reintenta solo).
      expect(generarPdf).not.toHaveBeenCalled();
      expect(repos.facturas.guardarPdfUrl).not.toHaveBeenCalled();
      // Marcada inválida → aprobación bloqueada.
      expect(resultado.esBorradorInvalido).toBe(true);
      expect(resultado.pdfUrl).toBeNull();
    },
  );

  it('debe_enumerar_los_campos_fiscales_faltantes_del_cliente', async () => {
    const { useCase } = montar({
      cliente: clienteCompleto({ dniNif: null, poblacion: null }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.camposFiscalesFaltantes).toEqual(
      expect.arrayContaining(['dniNif', 'poblacion']),
    );
  });
});

// ===========================================================================
// 3.8 — Error TRANSITORIO del servicio de PDF: la factura queda en borrador con
//        pdf_url = null y pdfPendiente = true; el fallo del PDF NO revierte la
//        creación de la factura (ya commiteada) ni propaga error al llamante.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — error transitorio del PDF con reintento (3.8)', () => {
  it('no_debe_revertir_la_creacion_de_la_factura_si_el_servicio_de_pdf_falla', async () => {
    const { useCase, repos } = montar({ pdfFalla: true });

    const resultado = await useCase.ejecutar(comando());

    // La factura se creó igualmente (en borrador, sin PDF).
    expect(repos.facturas.crear).toHaveBeenCalledTimes(1);
    expect(resultado.pdfUrl).toBeNull();
    expect(resultado.pdfPendiente).toBe(true);
    // No se guarda pdf_url porque el PDF falló.
    expect(repos.facturas.guardarPdfUrl).not.toHaveBeenCalled();
  });

  it('debe_distinguir_pdf_pendiente_transitorio_de_borrador_invalido_por_datos', async () => {
    // Datos fiscales OK pero el PDF falla → pdfPendiente=true, esBorradorInvalido=false.
    const { useCase } = montar({ pdfFalla: true, cliente: clienteCompleto() });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.pdfPendiente).toBe(true);
    expect(resultado.esBorradorInvalido).toBe(false);
  });
});

// ===========================================================================
// Orquestación: creación + numeración dentro de UNA unidad de trabajo.
// ===========================================================================

describe('GenerarFacturaSenalUseCase — orquestación transaccional', () => {
  it('debe_crear_y_numerar_dentro_de_una_unica_unidad_de_trabajo_y_guardar_pdf_url_en_tx_aparte_post_commit', async () => {
    // §D-5: la creación + numeración ocurren en UNA unidad de trabajo; el guardado de
    // pdf_url ocurre POST-COMMIT en una tx breve aparte (no in-tx con la creación), para
    // no sostener locks mientras se genera el PDF.
    const { useCase, uow, repos, generarPdf } = montar();

    await useCase.ejecutar(comando());

    // Dos unidades de trabajo: (1) crear+numerar, (2) guardar pdf_url post-commit.
    expect(uow.ejecutar).toHaveBeenCalledTimes(2);
    // La creación de la factura ocurre en la PRIMERA unidad de trabajo (in-tx).
    expect(repos.facturas.crear).toHaveBeenCalledTimes(1);
    // El PDF se genera FUERA de cualquier tx (post-commit) y su url se persiste después.
    expect(generarPdf).toHaveBeenCalledTimes(1);
    expect(repos.facturas.guardarPdfUrl).toHaveBeenCalledTimes(1);
  });

  it('debe_propagar_el_error_cuando_falla_la_creacion_para_que_la_tx_revierta', async () => {
    const { useCase } = montar({ fallarEn: 'crear' });

    await expect(useCase.ejecutar(comando())).rejects.toThrow('FALLO_CREAR');
  });
});
