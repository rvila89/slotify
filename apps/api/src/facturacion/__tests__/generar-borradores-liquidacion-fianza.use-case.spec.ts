/**
 * TESTS del caso de uso `GenerarBorradoresLiquidacionFianzaUseCase` (US-027 / UC-21, UC-22)
 * — fase TDD RED. tasks.md Fase 3: 3.3 (liquidación), 3.4 (fianza), 3.5 (fianza=0),
 * 3.6 (sin extras), 3.7 (idempotencia — vertiente de orquestación), 3.8 (no marcar
 * RESERVA_EXTRA), y AUDIT_LOG `crear` + alerta al Gestor.
 *
 * Trazabilidad: US-027; spec-delta `facturacion` (Requirements de generación automática de la
 * factura de liquidación y del recibo de fianza en borrador, desglose fiscal reutilizado,
 * numeración diferida a la emisión = `numero_factura` NULL, idempotencia por `(reserva_id,
 * tipo)`, omisión de fianza si `fianza_default_eur = 0`, alerta al Gestor, auditoría de la
 * creación); spec-delta `confirmacion` (disparo post-commit). design.md §D-1/§D-2/§D-3/§D-4/
 * §D-6. Contrato previsto §D-5: `GET /reservas/{id}/facturas` (colección con tipo, estado,
 * desglose, total, numero_factura nullable, flag de alerta).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La idempotencia REAL con transacciones y el doble
 * disparo concurrente viven en `generar-borradores-idempotencia.spec.ts`; aquí se fija la
 * ORQUESTACIÓN: guarda de origen (reserva_confirmada + liquidacion_status pendiente), cálculo
 * del total de liquidación (60 % + extras factura_id IS NULL), desglose fiscal reutilizado,
 * creación de AMBOS borradores con numero_factura NULL, omisión de fianza si el importe es 0,
 * NO marcar RESERVA_EXTRA con factura_id en borrador, AUDIT_LOG `crear` por documento y la
 * señal de alerta al Gestor (con/ sin fianza).
 *
 * RED: aún NO existe `facturacion/application/generar-borradores-liquidacion-fianza.use-case.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
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
const FAC_FIANZA_ID = 'fac-fianza-1';

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
  ...over,
});

const extra = (subtotal: string): ExtraPendiente => ({ subtotal });

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta UNA transacción de facturación
// que crea AMBOS borradores (atómica entre sí) + sus AUDIT_LOG.
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
  fianzaExistente?: BorradorFactura | null;
  fallarEn?: PuntoDeFallo;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async (_reservaId: string, tipo: string) => {
      if (tipo === 'liquidacion') return opciones.liquidacionExistente ?? null;
      if (tipo === 'fianza') return opciones.fianzaExistente ?? null;
      return null;
    }),
    crear: jest.fn(async (f: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
      const idFactura = f.tipo === 'liquidacion' ? FAC_LIQ_ID : FAC_FIANZA_ID;
      return { idFactura, numeroFactura: null, pdfUrl: null, fechaEmision: null, ...f };
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
  fianzaDefaultEur?: string;
  liquidacionExistente?: BorradorFactura | null;
  fianzaExistente?: BorradorFactura | null;
  fallarEn?: PuntoDeFallo;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaLiquidable();
  const repos = crearReposFake({
    liquidacionExistente: opciones.liquidacionExistente,
    fianzaExistente: opciones.fianzaExistente,
    fallarEn: opciones.fallarEn,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const cargarExtrasPendientes = jest.fn(async () => opciones.extrasPendientes ?? []);
  const cargarFianzaDefault = jest.fn(async () => opciones.fianzaDefaultEur ?? '1000.00');
  const deps: GenerarBorradoresLiquidacionFianzaDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    cargarExtrasPendientes,
    cargarFianzaDefault,
  };
  return {
    useCase: new GenerarBorradoresLiquidacionFianzaUseCase(deps),
    repos,
    uow,
    cargarReserva,
    cargarExtrasPendientes,
    cargarFianzaDefault,
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
// 3.3 — Factura de LIQUIDACIÓN en borrador: tipo='liquidacion', estado='borrador',
//        numero_factura=NULL, total = importe_liquidacion + Σ extras pendientes,
//        reserva_id/tenant_id correctos + desglose fiscal + AUDIT_LOG crear.
// ===========================================================================

describe('GenerarBorradores — factura de liquidación en borrador (3.3)', () => {
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
});

// ===========================================================================
// 3.4 — Recibo de FIANZA en borrador: tipo='fianza', estado='borrador',
//        numero_factura=NULL, total = TENANT_SETTINGS.fianza_default_eur,
//        reserva_id/tenant_id correctos + AUDIT_LOG crear.
// ===========================================================================

describe('GenerarBorradores — recibo de fianza en borrador (3.4)', () => {
  it('debe_crear_una_factura_tipo_fianza_en_borrador_con_total_igual_a_la_fianza_por_defecto', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '1000.00' });

    await useCase.ejecutar(comando());

    const fianza = crearArgsDe(repos, 'fianza');
    expect(fianza).toBeDefined();
    expect(fianza!.estado).toBe('borrador');
    expect(fianza!.total).toBe('1000.00');
    expect(fianza!.reservaId).toBe(RESERVA_ID);
    expect(fianza!.tenantId).toBe(TENANT);
  });

  it('debe_crear_la_fianza_con_numero_factura_NULL_diferido_a_la_emision', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '1000.00' });

    await useCase.ejecutar(comando());

    const fianza = crearArgsDe(repos, 'fianza');
    expect(fianza!.numeroFactura ?? null).toBeNull();
  });

  it('debe_registrar_AUDIT_LOG_accion_crear_entidad_FACTURA_para_la_fianza', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '1000.00' });

    await useCase.ejecutar(comando());

    const crearFianza = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear' && a.entidadId === FAC_FIANZA_ID);
    expect(crearFianza).toBeDefined();
    expect(crearFianza.entidad).toBe('FACTURA');
  });

  it('debe_crear_ambos_borradores_liquidacion_y_fianza_en_el_happy_path', async () => {
    const { useCase, repos } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
      fianzaDefaultEur: '1000.00',
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')).toBeDefined();
    expect(crearArgsDe(repos, 'fianza')).toBeDefined();
    expect(repos.facturas.crear).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// 3.5 — Edge case fianza_default_eur = 0: NO se crea la FACTURA de fianza;
//        fianza_status permanece pendiente; la liquidación SÍ se crea; la alerta
//        al Gestor menciona SOLO la liquidación.
// ===========================================================================

describe('GenerarBorradores — omisión de la fianza cuando fianza_default_eur = 0 (3.5)', () => {
  it('no_debe_crear_la_factura_de_fianza_cuando_el_importe_por_defecto_es_cero', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '0.00' });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'fianza')).toBeUndefined();
  });

  it('debe_crear_igualmente_la_liquidacion_aunque_la_fianza_se_omita', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '0.00' });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')).toBeDefined();
  });

  it('debe_indicar_en_el_resultado_que_la_fianza_fue_omitida_y_la_alerta_solo_cita_liquidacion', async () => {
    const { useCase } = montar({ fianzaDefaultEur: '0.00' });

    const resultado = await useCase.ejecutar(comando());

    // El resultado refleja que NO se generó fianza (para la alerta de UI, §D-6).
    expect(resultado.fianzaOmitida).toBe(true);
    expect(resultado.fianza).toBeNull();
    expect(resultado.liquidacion).not.toBeNull();
  });

  it('no_debe_registrar_AUDIT_LOG_de_creacion_de_fianza_cuando_se_omite', async () => {
    const { useCase, repos } = montar({ fianzaDefaultEur: '0.00' });

    await useCase.ejecutar(comando());

    const crearFianza = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear' && a.entidadId === FAC_FIANZA_ID);
    expect(crearFianza).toBeUndefined();
  });
});

// ===========================================================================
// 3.6 — Edge case sin RESERVA_EXTRA pendientes: la liquidación es solo el 60 %
//        (total = importe_liquidacion); la fianza se genera igualmente.
// ===========================================================================

describe('GenerarBorradores — liquidación sin extras pendientes es solo el 60 % (3.6)', () => {
  it('debe_dar_total_3600_en_la_liquidacion_cuando_no_hay_extras_con_factura_id_null', async () => {
    const { useCase, repos } = montar({
      reserva: reservaLiquidable({ importeLiquidacion: '3600.00' }),
      extrasPendientes: [],
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')!.total).toBe('3600.00');
  });

  it('debe_generar_igualmente_el_recibo_de_fianza_sin_extras_pendientes', async () => {
    const { useCase, repos } = montar({
      extrasPendientes: [],
      fianzaDefaultEur: '1000.00',
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'fianza')).toBeDefined();
  });
});

// ===========================================================================
// Guarda de origen: solo se generan borradores cuando la RESERVA está en
// reserva_confirmada Y liquidacion_status = pendiente.
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
// 3.7 — Idempotencia (vertiente de orquestación): si YA existen los borradores
//        (borrador o enviada), el use-case NO los duplica. Guarda por
//        (reserva_id, tipo) antes de crear cada documento.
// ===========================================================================

describe('GenerarBorradores — idempotencia guarda por (reserva_id, tipo) (3.7)', () => {
  const borradorPrevio = (tipo: 'liquidacion' | 'fianza', id: string): BorradorFactura => ({
    idFactura: id,
    tenantId: TENANT,
    reservaId: RESERVA_ID,
    numeroFactura: null,
    tipo,
    estado: 'borrador',
    total: tipo === 'liquidacion' ? '4100.00' : '1000.00',
    baseImponible: '0.00',
    ivaPorcentaje: '21.00',
    ivaImporte: '0.00',
  });

  it('no_debe_duplicar_la_liquidacion_cuando_ya_existe_un_borrador_para_la_reserva', async () => {
    const { useCase, repos } = montar({
      liquidacionExistente: borradorPrevio('liquidacion', 'fac-liq-prev'),
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.buscarPorReservaYTipo).toHaveBeenCalledWith(RESERVA_ID, 'liquidacion');
    expect(crearArgsDe(repos, 'liquidacion')).toBeUndefined();
  });

  it('no_debe_duplicar_ninguno_cuando_ambos_borradores_ya_existen', async () => {
    const { useCase, repos } = montar({
      liquidacionExistente: borradorPrevio('liquidacion', 'fac-liq-prev'),
      fianzaExistente: borradorPrevio('fianza', 'fac-fianza-prev'),
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.crear).not.toHaveBeenCalled();
  });

  it('debe_considerar_tambien_el_estado_enviada_como_existente_para_no_recrear', async () => {
    const enviada: BorradorFactura = {
      ...borradorPrevio('liquidacion', 'fac-liq-enviada'),
      estado: 'enviada',
      numeroFactura: 'F-2026-0042',
    };
    const { useCase, repos } = montar({ liquidacionExistente: enviada });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')).toBeUndefined();
  });

  it('debe_crear_solo_la_fianza_cuando_la_liquidacion_ya_existia', async () => {
    const { useCase, repos } = montar({
      liquidacionExistente: borradorPrevio('liquidacion', 'fac-liq-prev'),
      fianzaDefaultEur: '1000.00',
    });

    await useCase.ejecutar(comando());

    expect(crearArgsDe(repos, 'liquidacion')).toBeUndefined();
    expect(crearArgsDe(repos, 'fianza')).toBeDefined();
  });
});

// ===========================================================================
// 3.8 — NO se marcan los RESERVA_EXTRA con factura_id en la fase de borrador
//        (el vínculo se difiere a la emisión, US-028). El use-case NO recibe ni
//        invoca ningún puerto de marcado de extras.
// ===========================================================================

describe('GenerarBorradores — no marca RESERVA_EXTRA en borrador (3.8)', () => {
  it('no_debe_exponer_ni_invocar_ningun_puerto_de_marcado_de_extras_con_factura_id', async () => {
    const marcarExtras = jest.fn(async () => undefined);
    const { useCase, deps } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
    });

    // El use-case NO debe declarar ningún puerto de marcado en sus deps (§D-2).
    expect(
      (deps as unknown as Record<string, unknown>).marcarExtrasConFactura,
    ).toBeUndefined();

    await useCase.ejecutar(comando());

    // Aunque inyectáramos el doble, jamás se invocaría en la fase de borrador.
    expect(marcarExtras).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// D-6 — Alerta al Gestor: con liquidación + fianza generadas el resultado permite
//        la alerta "Documentos de liquidación y fianza pendientes de revisión".
// ===========================================================================

describe('GenerarBorradores — señal de alerta al Gestor (D-6)', () => {
  it('debe_reflejar_ambos_borradores_en_el_resultado_para_la_alerta_de_ambos', async () => {
    const { useCase } = montar({
      extrasPendientes: [extra('300.00'), extra('200.00')],
      fianzaDefaultEur: '1000.00',
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.liquidacion).not.toBeNull();
    expect(resultado.fianza).not.toBeNull();
    expect(resultado.fianzaOmitida).toBe(false);
  });
});

// ===========================================================================
// Orquestación transaccional: ambos borradores se crean en UNA unidad de trabajo
// (atómica entre sí, §D-1); un fallo propaga para que la tx revierta.
// ===========================================================================

describe('GenerarBorradores — orquestación transaccional atómica entre documentos (D-1)', () => {
  it('debe_crear_ambos_borradores_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar({
      extrasPendientes: [extra('300.00')],
      fianzaDefaultEur: '1000.00',
    });

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_propagar_el_error_cuando_falla_la_creacion_para_que_la_tx_revierta', async () => {
    const { useCase } = montar({ fallarEn: 'crear' });

    await expect(useCase.ejecutar(comando())).rejects.toThrow('FALLO_CREAR');
  });
});
