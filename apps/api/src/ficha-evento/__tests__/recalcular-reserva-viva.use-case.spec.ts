/**
 * TESTS del orquestador `RecalcularReservaVivaUseCase` (change `reserva-viva-edicion-
 * recalculo-ficha`, tasks.md 3.3 y 3.4) — fase TDD RED.
 *
 * Trazabilidad: design.md §D-4 (orden del recálculo transaccional, idempotente,
 * all-or-nothing) y §D-5/§D-7 (presupuesto de modificación + edge cases); spec-deltas
 * `facturacion` (re-congelado sin tocar la señal + regeneración de liquidación),
 * `presupuestos` (versión de modificación: pago inicial fijo + restante) y `reserva-viva`
 * (guarda de ventana viva re-evaluada en la tx).
 *
 * Orden (D-4):
 *   0. Guardas síncronas previas (existencia/RLS 404, ventana viva D-3 422, validación
 *      de duracionHoras/desglose 400/422).
 *   1. Nuevo total con `CalculadoraTarifaService` (extras vigentes `factura_id IS NULL`).
 *   2. En UNA tx: nueva versión PRESUPUESTO de modificación (`origen='modificacion'`,
 *      `pagoInicial=importe_senal`, `liquidacionRestante=nuevo_total−importe_senal`);
 *      persistir el desglose estructurado en la RESERVA; re-congelar importe_total /
 *      importe_liquidacion (importe_senal INTACTO); regenerar FACTURA liquidación
 *      (borrador|enviada, nunca cobrada). La guarda D-3 se RE-EVALÚA dentro de la tx.
 *   3. Post-commit: email E9 (no revierte).
 *
 * Ejercita el ORQUESTADOR contra DOBLES DE LOS PUERTOS (spies/stubs in-memory), sin
 * Prisma real (hexagonal, hook `no-infra-in-domain`).
 *
 * RED: aún NO existe `ficha-evento/application/recalcular-reserva-viva.use-case.ts`; el
 * import falla y la batería está en ROJO. GREEN es de `backend-developer`.
 */
import {
  RecalcularReservaVivaUseCase,
  FueraDeVentanaVivaError,
  PrecioManualRequeridoError,
  ImporteSenalInvalidoError,
  ReservaRecalculoNoEncontradaError,
  type RecalcularReservaVivaDeps,
  type RecalcularReservaVivaComando,
  type ReservaRecalculo,
  type ReposRecalculo,
} from '../application/recalcular-reserva-viva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-viva';
const FECHA_EVENTO = new Date('2026-09-12T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Proyección de la RESERVA en la ventana viva (importes congelados + estado + status).
// ---------------------------------------------------------------------------

const reservaRecalculo = (
  over: Partial<ReservaRecalculo> = {},
): ReservaRecalculo => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'reserva_confirmada',
  preEventoStatus: 'en_curso',
  liquidacionStatus: 'pendiente',
  fechaEvento: FECHA_EVENTO,
  idioma: 'es',
  importeTotal: '3000.00',
  importeSenal: '1200.00',
  importeLiquidacion: '1800.00',
  duracionHoras: 8,
  numAdultosNinosMayores4: 40,
  numNinosMenores4: 5,
  numInvitadosFinal: null,
  facturaLiquidacion: {
    idFactura: 'fac-liq',
    tipo: 'liquidacion',
    estado: 'borrador',
  },
  ...over,
});

// ---------------------------------------------------------------------------
// Motor de tarifa (stub) — devuelve el total configurado o `tarifaAConsultar`.
// ---------------------------------------------------------------------------

const motorTarifaConTotal = (totalEur: string) => ({
  calcular: jest.fn(async () => ({
    temporada: 'media' as const,
    tarifaAConsultar: false,
    precioTarifaEur: Number(totalEur),
    extrasTotalEur: 0,
    totalEur: Number(totalEur),
    tarifaId: 'tar-1',
  })),
});

const motorTarifaAConsultar = () => ({
  calcular: jest.fn(async () => ({
    temporada: 'media' as const,
    tarifaAConsultar: true,
    precioTarifaEur: null,
    extrasTotalEur: null,
    totalEur: null,
    tarifaId: null,
  })),
});

// ---------------------------------------------------------------------------
// Repos tx-bound (spies) + unidad de trabajo que ejecuta el trabajo con ellos.
// ---------------------------------------------------------------------------

const montarRepos = () => {
  const repos: ReposRecalculo = {
    presupuestos: {
      versionMaxima: jest.fn(async () => 2),
      crearVersionModificacion: jest.fn(async (params) => ({
        idPresupuesto: 'pre-v3',
        version: params.version,
        origen: 'modificacion',
        total: params.total,
        pagoInicial: params.pagoInicial,
        liquidacionRestante: params.liquidacionRestante,
      })),
    },
    reservas: {
      recongelarImportes: jest.fn(async () => undefined),
      guardarDesglose: jest.fn(async () => undefined),
    },
    facturas: {
      regenerarLiquidacion: jest.fn(async () => undefined),
      // Spy de la fianza: NUNCA debe ser invocado con una mutación.
      regenerarFianza: jest.fn(async () => undefined),
    },
    auditoria: {
      registrar: jest.fn(async () => undefined),
    },
  } as unknown as ReposRecalculo;

  const unidadDeTrabajo = {
    ejecutar: jest.fn(async (_tenantId: string, trabajo: (r: ReposRecalculo) => Promise<unknown>) =>
      trabajo(repos),
    ),
  };

  return { repos, unidadDeTrabajo };
};

const montar = (opciones: {
  reserva?: ReservaRecalculo | null;
  totalEur?: string;
  tarifaAConsultar?: boolean;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaRecalculo();
  const { repos, unidadDeTrabajo } = montarRepos();
  const cargarReserva = jest.fn(async () => reserva);
  const motorTarifa = opciones.tarifaAConsultar
    ? motorTarifaAConsultar()
    : motorTarifaConTotal(opciones.totalEur ?? '3600.00');
  const dispararE9 = jest.fn(async () => undefined);

  const deps = {
    motorTarifa,
    unidadDeTrabajo,
    cargarReserva,
    dispararE9,
  } as unknown as RecalcularReservaVivaDeps;

  return {
    useCase: new RecalcularReservaVivaUseCase(deps),
    repos,
    unidadDeTrabajo,
    cargarReserva,
    motorTarifa,
    dispararE9,
  };
};

const comando = (
  over: Partial<RecalcularReservaVivaComando> = {},
): RecalcularReservaVivaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  duracionHoras: 12,
  numAdultosNinosMayores4: 48,
  numNinosMenores4: 2,
  ...over,
});

// ===========================================================================
// 3.3 — importe_senal INTACTO tras el recálculo.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — importe_senal intacto (3.3)', () => {
  it('no_debe_modificar_el_importe_senal_al_recongelar', async () => {
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    // El re-congelado recibe el nuevo total y liquidación, PERO el importe_senal
    // original (1200.00) no cambia: nunca se pasa un importe_senal distinto.
    const params = (repos.reservas.recongelarImportes as jest.Mock).mock.calls[0][0];
    expect(params.importeTotal).toBe('3600.00');
    expect(params.importeSenal).toBe('1200.00');
  });
});

// ===========================================================================
// 3.3 — importe_total e importe_liquidacion RE-CONGELADOS con el nuevo valor.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — re-congelado de total y liquidación (3.3)', () => {
  it('debe_recongelar_importe_total_e_importe_liquidacion_con_el_nuevo_valor', async () => {
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    const params = (repos.reservas.recongelarImportes as jest.Mock).mock.calls[0][0];
    // liquidacion = nuevo_total − importe_senal = 3600 − 1200 = 2400.
    expect(params.importeTotal).toBe('3600.00');
    expect(params.importeLiquidacion).toBe('2400.00');
  });
});

// ===========================================================================
// 3.3 — Nueva versión de PRESUPUESTO de modificación (pago inicial fijo + restante).
// ===========================================================================

describe('RecalcularReservaVivaUseCase — presupuesto de modificación (3.3)', () => {
  it('debe_crear_una_version_de_modificacion_con_pagoInicial_fijo_y_restante', async () => {
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    expect(repos.presupuestos.crearVersionModificacion).toHaveBeenCalledTimes(1);
    const params = (repos.presupuestos.crearVersionModificacion as jest.Mock).mock
      .calls[0][0];
    expect(params.origen).toBe('modificacion');
    // version = MAX(2) + 1.
    expect(params.version).toBe(3);
    // Pago inicial = importe_senal congelado (NO se recalcula el 40%).
    expect(params.pagoInicial).toBe('1200.00');
    // Liquidación restante = nuevo_total − importe_senal.
    expect(params.liquidacionRestante).toBe('2400.00');
    expect(params.total).toBe('3600.00');
  });

  it('no_debe_repartir_40_60_sobre_el_nuevo_total', async () => {
    // 40% de 3600 sería 1440; el pago inicial debe seguir siendo 1200 (la señal fija).
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    const params = (repos.presupuestos.crearVersionModificacion as jest.Mock).mock
      .calls[0][0];
    expect(params.pagoInicial).not.toBe('1440.00');
    expect(params.pagoInicial).toBe('1200.00');
  });
});

// ===========================================================================
// 3.3 — FACTURA de liquidación regenerada (borrador|enviada); FIANZA intacta.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — regeneración de liquidación y fianza intacta (3.3)', () => {
  it('debe_regenerar_la_liquidacion_cuando_esta_en_borrador', async () => {
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    expect(repos.facturas.regenerarLiquidacion).toHaveBeenCalledTimes(1);
  });

  it('debe_regenerar_la_liquidacion_aunque_ya_estuviera_enviada', async () => {
    const { useCase, repos } = montar({
      reserva: reservaRecalculo({
        facturaLiquidacion: { idFactura: 'fac-liq', tipo: 'liquidacion', estado: 'enviada' },
      }),
      totalEur: '3600.00',
    });

    await useCase.ejecutar(comando());

    expect(repos.facturas.regenerarLiquidacion).toHaveBeenCalledTimes(1);
  });

  it('no_debe_tocar_la_FACTURA_de_fianza', async () => {
    const { useCase, repos } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    expect(repos.facturas.regenerarFianza).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 — Sin cambio real = no-op (no versiona, no persiste, no reenvía email).
// ===========================================================================

describe('RecalcularReservaVivaUseCase — sin cambio real es no-op (3.3)', () => {
  it('no_debe_versionar_ni_persistir_ni_enviar_email_cuando_el_aforo_y_duracion_no_cambian', async () => {
    // La reserva ya está en duracionHoras=8, desglose 40/5.
    const { useCase, repos, dispararE9, unidadDeTrabajo } = montar({ totalEur: '3000.00' });

    // Comando con los MISMOS valores estructurados que la reserva vigente.
    await useCase.ejecutar(
      comando({ duracionHoras: 8, numAdultosNinosMayores4: 40, numNinosMenores4: 5 }),
    );

    expect(repos.presupuestos.crearVersionModificacion).not.toHaveBeenCalled();
    expect(repos.reservas.recongelarImportes).not.toHaveBeenCalled();
    expect(unidadDeTrabajo.ejecutar).not.toHaveBeenCalled();
    expect(dispararE9).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — tarifaAConsultar (>50 o TarifaNoConfigurada) exige precioManualEur.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — tarifaAConsultar exige precio manual (3.4)', () => {
  it('debe_lanzar_PrecioManualRequeridoError_cuando_tarifaAConsultar_sin_precioManual', async () => {
    const { useCase } = montar({ tarifaAConsultar: true });

    await expect(
      useCase.ejecutar(comando({ numAdultosNinosMayores4: 60 })),
    ).rejects.toBeInstanceOf(PrecioManualRequeridoError);
  });

  it('debe_usar_el_precioManualEur_como_nuevo_total_cuando_tarifaAConsultar', async () => {
    const { useCase, repos } = montar({ tarifaAConsultar: true });

    await useCase.ejecutar(
      comando({ numAdultosNinosMayores4: 60, precioManualEur: '5000.00' }),
    );

    const paramsReserva = (repos.reservas.recongelarImportes as jest.Mock).mock.calls[0][0];
    expect(paramsReserva.importeTotal).toBe('5000.00');
    // liquidacion = 5000 − 1200 = 3800.
    expect(paramsReserva.importeLiquidacion).toBe('3800.00');
    const paramsPresupuesto = (repos.presupuestos.crearVersionModificacion as jest.Mock)
      .mock.calls[0][0];
    expect(paramsPresupuesto.liquidacionRestante).toBe('3800.00');
  });
});

// ===========================================================================
// 3.4 — Concurrencia: la guarda de ventana viva se RE-EVALÚA dentro de la tx.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — guarda re-evaluada dentro de la tx (3.4)', () => {
  it('debe_lanzar_FueraDeVentanaVivaError_si_la_ficha_se_cerro_al_releer_en_la_tx', async () => {
    // La carga inicial ve la ventana abierta, pero la re-lectura bajo la tx ve `cerrado`.
    const abierta = reservaRecalculo({ preEventoStatus: 'en_curso' });
    const cerradaEnTx = reservaRecalculo({ preEventoStatus: 'cerrado' });
    const cargarReserva = jest
      .fn()
      .mockResolvedValueOnce(abierta) // guarda previa
      .mockResolvedValue(cerradaEnTx); // re-lectura en la tx
    const { repos, unidadDeTrabajo } = montarRepos();
    const deps = {
      motorTarifa: motorTarifaConTotal('3600.00'),
      unidadDeTrabajo,
      cargarReserva,
      dispararE9: jest.fn(async () => undefined),
    } as unknown as RecalcularReservaVivaDeps;
    const useCase = new RecalcularReservaVivaUseCase(deps);

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FueraDeVentanaVivaError,
    );
    // No se re-congela nada si la guarda re-evaluada falla.
    expect(repos.reservas.recongelarImportes).not.toHaveBeenCalled();
  });

  it('debe_lanzar_FueraDeVentanaVivaError_si_la_liquidacion_se_cobro_al_releer_en_la_tx', async () => {
    const abierta = reservaRecalculo({ liquidacionStatus: 'pendiente' });
    const cobradaEnTx = reservaRecalculo({ liquidacionStatus: 'cobrada' });
    const cargarReserva = jest
      .fn()
      .mockResolvedValueOnce(abierta)
      .mockResolvedValue(cobradaEnTx);
    const { repos, unidadDeTrabajo } = montarRepos();
    const deps = {
      motorTarifa: motorTarifaConTotal('3600.00'),
      unidadDeTrabajo,
      cargarReserva,
      dispararE9: jest.fn(async () => undefined),
    } as unknown as RecalcularReservaVivaDeps;
    const useCase = new RecalcularReservaVivaUseCase(deps);

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FueraDeVentanaVivaError,
    );
    expect(repos.facturas.regenerarLiquidacion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Guarda de ventana viva PREVIA (fuera de la tx): estado no confirmado / ficha
//        cerrada / liquidación cobrada → 422 sin efectos.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — guarda de ventana viva previa (3.4)', () => {
  it('debe_lanzar_FueraDeVentanaVivaError_cuando_la_reserva_esta_en_pre_reserva', async () => {
    const { useCase, unidadDeTrabajo } = montar({
      reserva: reservaRecalculo({ estado: 'pre_reserva' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FueraDeVentanaVivaError,
    );
    expect(unidadDeTrabajo.ejecutar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_ReservaRecalculoNoEncontrada_cuando_la_reserva_no_existe_para_el_tenant', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaRecalculoNoEncontradaError,
    );
  });
});

// ===========================================================================
// 3.4 — importe_senal NULO → error de dominio (422), no se puede derivar el restante.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — importe_senal nulo (3.4)', () => {
  it('debe_lanzar_ImporteSenalInvalidoError_cuando_importe_senal_es_nulo', async () => {
    const { useCase, unidadDeTrabajo } = montar({
      reserva: reservaRecalculo({ importeSenal: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ImporteSenalInvalidoError,
    );
    expect(unidadDeTrabajo.ejecutar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 — Post-commit: email E9 disparado tras el commit exitoso.
// ===========================================================================

describe('RecalcularReservaVivaUseCase — email E9 post-commit (3.3)', () => {
  it('debe_disparar_el_email_E9_de_modificacion_tras_el_recalculo', async () => {
    const { useCase, dispararE9 } = montar({ totalEur: '3600.00' });

    await useCase.ejecutar(comando());

    expect(dispararE9).toHaveBeenCalledTimes(1);
    const params = (dispararE9 as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(params)).toContain(RESERVA_ID);
  });
});
