/**
 * TESTS del caso de uso `GenerarBorradoresLiquidacionFianzaUseCase`
 * (fix-liquidacion-fianza-independientes / UC-21) — comportamiento NUEVO.
 *
 * La fianza deja de ser una FACTURA que se emite: al activar los sub-procesos SOLO se genera
 * el borrador de LIQUIDACIÓN (spec-delta `facturacion` MODIFIED "Generación automática de la
 * factura de liquidación en borrador…", scenario "La activación de los sub-procesos no genera
 * ningún borrador de fianza"; REMOVED "Generación automática del recibo de fianza en borrador").
 * design.md §D-1 / §D-2.
 *
 * El resultado conserva la firma `{ liquidacion, fianza, fianzaOmitida }` por compatibilidad,
 * pero `fianza` es SIEMPRE `null` y `fianzaOmitida` es SIEMPRE `true` (nunca se crea recibo de
 * fianza).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Fija la ORQUESTACIÓN: guarda de origen
 * (reserva_confirmada), cálculo del total de liquidación (60 % + extras factura_id IS NULL),
 * desglose fiscal reutilizado, creación de UN ÚNICO borrador (liquidación) con numero_factura
 * NULL, NO crear NINGÚN documento de fianza, NO marcar RESERVA_EXTRA en borrador, AUDIT_LOG
 * `crear` solo para la liquidación e idempotencia por (reserva_id, tipo).
 */
import {
  GenerarBorradoresLiquidacionFianzaUseCase,
  ReservaNoConfirmadaError,
  ReservaBorradoresNoEncontradaError,
  type GenerarBorradoresLiquidacionFianzaDeps,
  type GenerarBorradoresComando,
  type ReservaLiquidable,
  type ExtraPendiente,
  type BorradorFactura,
  type RepositoriosBorradores,
  type UnidadDeTrabajoBorradoresPort,
} from '../application/generar-borradores-liquidacion-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const RESERVA_ID = 'res-conf-1';
const FAC_LIQ_ID = 'fac-liq-1';

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA reserva_confirmada con importe_liquidacion congelado
// (US-021) y sub-procesos de liquidación/fianza en `pendiente`.
// ---------------------------------------------------------------------------

const reservaLiquidable = (over: Partial<ReservaLiquidable> = {}): ReservaLiquidable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  codigo: 'SLO-2026-0027',
  estado: 'reserva_confirmada',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  importeLiquidacion: '3600.00',
  // 6.3: régimen IVA del presupuesto aceptado. CON IVA por defecto (21 %); el test SIN IVA
  // lo sobrescribe. El use-case lo propaga a `calcularDesgloseFactura` (design.md §D-1).
  regimenIva: 'con_iva',
  ...over,
});

const extra = (subtotal: string): ExtraPendiente => ({ subtotal });

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta UNA transacción de facturación
// que crea SOLO el borrador de liquidación + su AUDIT_LOG.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosBorradores {
  facturas: {
    buscarPorReservaYTipo: jest.Mock;
    crear: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo = 'crear' | 'auditoria';

const crearReposFake = (opciones: {
  liquidacionExistente?: BorradorFactura | null;
  fallarEn?: PuntoDeFallo;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async (_reservaId: string, tipo: string) => {
      if (tipo === 'liquidacion') return opciones.liquidacionExistente ?? null;
      return null;
    }),
    crear: jest.fn(async (f: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
      return { idFactura: FAC_LIQ_ID, numeroFactura: null, pdfUrl: null, fechaEmision: null, ...f };
    }),
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
): UnidadDeTrabajoBorradoresPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosBorradores) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaLiquidable | null;
  extrasPendientes?: ReadonlyArray<ExtraPendiente>;
  liquidacionExistente?: BorradorFactura | null;
  fallarEn?: PuntoDeFallo;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaLiquidable();
  const repos = crearReposFake({
    liquidacionExistente: opciones.liquidacionExistente,
    fallarEn: opciones.fallarEn,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const cargarExtrasPendientes = jest.fn(async () => opciones.extrasPendientes ?? []);
  const deps: GenerarBorradoresLiquidacionFianzaDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    cargarExtrasPendientes,
  };
  return {
    useCase: new GenerarBorradoresLiquidacionFianzaUseCase(deps),
    repos,
    uow,
    cargarReserva,
    cargarExtrasPendientes,
    deps,
  };
};

const comando = (
  over: Partial<GenerarBorradoresComando> = {},
): GenerarBorradoresComando => ({
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  ...over,
});

/** Localiza la llamada a `crear` de un tipo concreto. */
const crearArgsDe = (repos: ReposFake, tipo: string): Record<string, unknown> | undefined =>
  repos.facturas.crear.mock.calls.map((c) => c[0]).find((f) => f.tipo === tipo);

// ===========================================================================
// Factura de LIQUIDACIÓN en borrador: tipo='liquidacion', estado='borrador',
// numero_factura=NULL, total = importe_liquidacion + Σ extras pendientes,
// reserva_id/tenant_id correctos + desglose fiscal + AUDIT_LOG crear.
// ===========================================================================

describe('GenerarBorradores — factura de liquidación en borrador', () => {
  it('debe_crear_una_factura_tipo_liquidacion_en_borrador_con_total_4100_incluyendo_extras', async () => {
    const { useCase, repos } = montar({
      reserva: reservaLiquidable({ importeLiquidacion: '3600.00' }),
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    await useCase.ejecutar(comando());

    const liq = crearArgsDe(repos, 'liquidacion');
    expect(liq).toBeDefined();
    expect(liq!.estado).toBe('borrador');
    expect(liq!.total).toBe('4100.00');
    expect(liq!.reservaId).toBe(RESERVA_ID);
    expect(liq!.tenantId).toBe(TENANT);
  });

  it('debe_crear_la_liquidacion_con_numero_factura_NULL_diferido_a_la_emision', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const liq = crearArgsDe(repos, 'liquidacion');
    expect(liq!.numeroFactura ?? null).toBeNull();
  });

  it('debe_congelar_el_desglose_fiscal_3388_43_base_711_57_iva_para_4100_de_total', async () => {
    const { useCase, repos } = montar({
      reserva: reservaLiquidable({ importeLiquidacion: '3600.00' }),
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    await useCase.ejecutar(comando());

    const liq = crearArgsDe(repos, 'liquidacion');
    expect(liq!.baseImponible).toBe('3388.43');
    expect(liq!.ivaPorcentaje).toBe('21.00');
    expect(liq!.ivaImporte).toBe('711.57');
    // Invariante contable: base + iva = total EXACTO.
    expect(Number(liq!.baseImponible) + Number(liq!.ivaImporte)).toBe(4100);
  });

  it('debe_registrar_AUDIT_LOG_accion_crear_entidad_FACTURA_para_la_liquidacion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const crearLiq = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear' && a.entidadId === FAC_LIQ_ID);
    expect(crearLiq).toBeDefined();
    expect(crearLiq.entidad).toBe('FACTURA');
  });

  it('debe_emitir_la_liquidacion_SIN_IVA_base_igual_al_total_e_iva_cero_cuando_regimen_es_sin_iva', async () => {
    // 6.3: presupuesto aceptado SIN IVA (efectivo) → la factura de liquidación se emite con
    // ivaPorcentaje=0, ivaImporte=0, baseImponible=total. El use-case usa `regimenIva` del
    // ReservaLiquidable al llamar a `calcularDesgloseFactura` (design.md §D-1).
    const { useCase, repos } = montar({
      reserva: reservaLiquidable({ importeLiquidacion: '3600.00', regimenIva: 'sin_iva' }),
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    await useCase.ejecutar(comando());

    const liq = crearArgsDe(repos, 'liquidacion');
    expect(liq).toBeDefined();
    expect(liq!.total).toBe('4100.00');
    expect(liq!.ivaPorcentaje).toBe('0.00');
    expect(liq!.ivaImporte).toBe('0.00');
    expect(liq!.baseImponible).toBe('4100.00');
  });
});

// ===========================================================================
// NUEVO (fix-liquidacion-fianza-independientes): la activación de los sub-procesos
// NO genera NINGÚN borrador de fianza. La fianza deja de ser una FACTURA.
// spec-delta `facturacion`: MODIFIED "…no genera ningún borrador de fianza";
// REMOVED "Generación automática del recibo de fianza en borrador".
// ===========================================================================

describe('GenerarBorradores — la fianza NO se genera como FACTURA (fix-liquidacion-fianza-independientes)', () => {
  it('no_debe_crear_ninguna_factura_de_tipo_fianza', async () => {
    const { useCase, repos } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'fianza')).toBeUndefined();
  });

  it('debe_crear_UNA_SOLA_factura_en_el_happy_path_solo_la_liquidacion', async () => {
    const { useCase, repos } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.crear).toHaveBeenCalledTimes(1);
    expect(crearArgsDe(repos, 'liquidacion')).toBeDefined();
  });

  it('debe_devolver_fianza_null_y_fianzaOmitida_true_conservando_la_firma', async () => {
    const { useCase } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.liquidacion).not.toBeNull();
    // La fianza NUNCA se genera como FACTURA: la firma se conserva pero es null/true.
    expect(resultado.fianza).toBeNull();
    expect(resultado.fianzaOmitida).toBe(true);
  });

  it('no_debe_registrar_ningun_AUDIT_LOG_de_creacion_de_fianza', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const crearFianza = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find(
        (a) => a.accion === 'crear' && (a.datosNuevos as { tipo?: string } | null)?.tipo === 'fianza',
      );
    expect(crearFianza).toBeUndefined();
  });

  it('no_debe_exponer_ni_usar_un_puerto_de_fianza_por_defecto_en_sus_deps', async () => {
    const { deps } = montar();

    const registro = deps as unknown as Record<string, unknown>;
    // El use-case ya no depende de ningún puerto de importe de fianza por defecto.
    expect(registro.cargarFianzaDefault).toBeUndefined();
    expect(registro.fianzaDefaultEur).toBeUndefined();
  });
});

// ===========================================================================
// Edge case sin RESERVA_EXTRA pendientes: la liquidación es solo el 60 %
// (total = importe_liquidacion).
// ===========================================================================

describe('GenerarBorradores — liquidación sin extras pendientes es solo el 60 %', () => {
  it('debe_dar_total_3600_en_la_liquidacion_cuando_no_hay_extras_con_factura_id_null', async () => {
    const { useCase, repos } = montar({
      reserva: reservaLiquidable({ importeLiquidacion: '3600.00' }),
      extrasPendientes: [],
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')!.total).toBe('3600.00');
  });
});

// ===========================================================================
// Guarda de origen: solo se generan borradores cuando la RESERVA está en
// reserva_confirmada.
// ===========================================================================

describe('GenerarBorradores — guarda de estado de la reserva', () => {
  const estadosInvalidos: ReadonlyArray<ReservaLiquidable['estado']> = [
    'pre_reserva',
    'consulta',
    'reserva_cancelada',
  ];

  it.each(estadosInvalidos)(
    'debe_rechazar_con_ReservaNoConfirmada_cuando_la_reserva_esta_en_%s_sin_crear_facturas',
    async (estado) => {
      const { useCase, repos } = montar({ reserva: reservaLiquidable({ estado }) });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ReservaNoConfirmadaError,
      );
      expect(repos.facturas.crear).not.toHaveBeenCalled();
    },
  );

  it('debe_lanzar_ReservaBorradoresNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase, repos } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaBorradoresNoEncontradaError);
    expect(repos.facturas.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Idempotencia (vertiente de orquestación): si YA existe el borrador de
// liquidación (borrador o enviada), el use-case NO lo duplica. Guarda por
// (reserva_id, tipo) antes de crear.
// ===========================================================================

describe('GenerarBorradores — idempotencia guarda por (reserva_id, tipo)', () => {
  const borradorPrevio = (id: string, estado: BorradorFactura['estado'] = 'borrador'): BorradorFactura => ({
    idFactura: id,
    tenantId: TENANT,
    reservaId: RESERVA_ID,
    numeroFactura: estado === 'enviada' ? 'F-2026-0042' : null,
    tipo: 'liquidacion',
    estado,
    total: '4100.00',
    baseImponible: '3388.43',
    ivaPorcentaje: '21.00',
    ivaImporte: '711.57',
  });

  it('no_debe_duplicar_la_liquidacion_cuando_ya_existe_un_borrador_para_la_reserva', async () => {
    const { useCase, repos } = montar({
      liquidacionExistente: borradorPrevio('fac-liq-prev'),
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.buscarPorReservaYTipo).toHaveBeenCalledWith(RESERVA_ID, 'liquidacion');
    expect(crearArgsDe(repos, 'liquidacion')).toBeUndefined();
    expect(repos.facturas.crear).not.toHaveBeenCalled();
  });

  it('debe_considerar_tambien_el_estado_enviada_como_existente_para_no_recrear', async () => {
    const { useCase, repos } = montar({
      liquidacionExistente: borradorPrevio('fac-liq-enviada', 'enviada'),
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')).toBeUndefined();
  });

  it('debe_devolver_la_liquidacion_existente_sin_efectos', async () => {
    const previa = borradorPrevio('fac-liq-prev');
    const { useCase } = montar({ liquidacionExistente: previa });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.liquidacion.idFactura).toBe('fac-liq-prev');
    expect(resultado.fianza).toBeNull();
    expect(resultado.fianzaOmitida).toBe(true);
  });
});

// ===========================================================================
// NO se marcan los RESERVA_EXTRA con factura_id en la fase de borrador (el
// vínculo se difiere a la emisión). El use-case NO recibe ni invoca ningún
// puerto de marcado de extras.
// ===========================================================================

describe('GenerarBorradores — no marca RESERVA_EXTRA en borrador', () => {
  it('no_debe_exponer_ni_invocar_ningun_puerto_de_marcado_de_extras_con_factura_id', async () => {
    const { useCase, deps } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    expect(
      (deps as unknown as Record<string, unknown>).marcarExtrasConFactura,
    ).toBeUndefined();

    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();
  });
});

// ===========================================================================
// Orquestación transaccional: el borrador se crea en UNA unidad de trabajo; un
// fallo propaga para que la tx revierta.
// ===========================================================================

describe('GenerarBorradores — orquestación transaccional', () => {
  it('debe_crear_el_borrador_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar({
      extrasPendientes: [extra('300.00')],
    });

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_propagar_el_error_cuando_falla_la_creacion_para_que_la_tx_revierta', async () => {
    const { useCase } = montar({ fallarEn: 'crear' });

    await expect(useCase.ejecutar(comando())).rejects.toThrow('FALLO_CREAR');
  });
});
