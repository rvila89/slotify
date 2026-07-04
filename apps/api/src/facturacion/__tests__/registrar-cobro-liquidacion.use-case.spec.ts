/**
 * TESTS del caso de uso `RegistrarCobroLiquidacionUseCase` (US-029 / UC-21 pasos 7-10) —
 * fase TDD RED. tasks.md Fase 3: 3.4 (registro del cobro), 3.5 (justificante opcional /
 * vinculado), 3.6 (discrepancia no bloquea), 3.8 (bloqueos precondición/doble cobro).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Aquí se fija la ORQUESTACIÓN atómica (design.md
 * §D-2 opción A): dentro de UNA unidad de trabajo se relee la RESERVA con bloqueo de fila
 * (`SELECT ... FOR UPDATE`, aquí mockeado), se evalúa la guarda de precondición/doble cobro,
 * se crea (si aplica) el DOCUMENTO del justificante, se crea el PAGO, se transiciona
 * `FACTURA(liquidacion).estado='cobrada'` + `RESERVA.liquidacion_status='cobrada'` y se
 * registra AUDIT_LOG. La discrepancia de importe alerta pero NO bloquea (§D-3).
 *
 * La CONCURRENCIA REAL del `FOR UPDATE` (dos cobros simultáneos → un único PAGO) vive en
 * `registrar-cobro-concurrencia.spec.ts` (transacción real contra Postgres). Aquí se fija la
 * lógica de orquestación con dobles.
 *
 * Trazabilidad: US-029, spec-delta `facturacion` (Requirements "Registro del cobro…", "El
 * justificante de pago es opcional", "Discrepancia de importe alerta pero no bloquea", "Guarda
 * contra el doble cobro", "Precondición de estado — solo se cobra desde facturada", "El cobro
 * habilita una precondición del inicio del evento sin transicionar la reserva"). Contrato:
 * `registrarCobroLiquidacion` (200 con `alertaDiscrepancia?`; 409 `LIQUIDACION_YA_COBRADA` /
 * `LIQUIDACION_NO_FACTURADA`; 404 `JUSTIFICANTE_NO_ENCONTRADO`).
 *
 * RED: aún NO existe `facturacion/application/registrar-cobro-liquidacion.use-case.ts`. El
 * import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  RegistrarCobroLiquidacionUseCase,
  LiquidacionYaCobradaError,
  LiquidacionNoFacturadaError,
  FacturaLiquidacionNoEncontradaError,
  JustificanteNoEncontradoError,
  type RegistrarCobroLiquidacionDeps,
  type RegistrarCobroLiquidacionComando,
  type FacturaCobrable,
  type ReservaCobro,
  type DocumentoJustificante,
  type RepositoriosCobro,
  type UnidadDeTrabajoCobroPort,
  type ClockPort,
} from '../application/registrar-cobro-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_LIQ_ID = 'fac-liq-1';
const DOC_JUSTIF_ID = '11111111-1111-1111-1111-111111111111';
const USUARIO_ID = 'usr-gestor-1';
const NUEVO_PAGO_ID = 'pago-nuevo-1';

const HOY = new Date('2026-06-15T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => HOY };

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(liquidacion) 'enviada' y RESERVA 'facturada'.
// ---------------------------------------------------------------------------

const facturaLiquidacion = (over: Partial<FacturaCobrable> = {}): FacturaCobrable => ({
  idFactura: FAC_LIQ_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: 'F-2026-0042',
  tipo: 'liquidacion',
  estado: 'enviada',
  total: '4100.00',
  ...over,
});

const reservaCobro = (over: Partial<ReservaCobro> = {}): ReservaCobro => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0029',
  estado: 'reserva_confirmada',
  liquidacionStatus: 'facturada',
  ...over,
});

const documentoJustificante = (
  over: Partial<DocumentoJustificante> = {},
): DocumentoJustificante => ({
  idDocumento: DOC_JUSTIF_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  tipo: 'justificante_pago',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW. La relectura FOR UPDATE de la RESERVA la simula
// `reservas.releerConBloqueo`; el use-case evalúa la guarda con ese estado.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosCobro {
  facturas: {
    buscarLiquidacionPorReserva: jest.Mock;
    marcarCobrada: jest.Mock;
  };
  reservas: {
    releerConBloqueo: jest.Mock;
    avanzarLiquidacionStatus: jest.Mock;
  };
  documentos: {
    buscarJustificante: jest.Mock;
  };
  pagos: {
    crear: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  liquidacion?: FacturaCobrable | null;
  reservaBloqueada?: ReservaCobro | null;
  justificante?: DocumentoJustificante | null;
} = {}): ReposFake => ({
  facturas: {
    buscarLiquidacionPorReserva: jest.fn(async () =>
      'liquidacion' in opciones ? opciones.liquidacion : facturaLiquidacion(),
    ),
    marcarCobrada: jest.fn(async () => undefined),
  },
  reservas: {
    releerConBloqueo: jest.fn(async () =>
      'reservaBloqueada' in opciones ? opciones.reservaBloqueada : reservaCobro(),
    ),
    avanzarLiquidacionStatus: jest.fn(async () => undefined),
  },
  documentos: {
    buscarJustificante: jest.fn(async () =>
      'justificante' in opciones ? opciones.justificante : documentoJustificante(),
    ),
  },
  pagos: {
    crear: jest.fn(async (p: Record<string, unknown>) => ({ idPago: NUEVO_PAGO_ID, ...p })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoCobroPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosCobro) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  liquidacion?: FacturaCobrable | null;
  reservaBloqueada?: ReservaCobro | null;
  justificante?: DocumentoJustificante | null;
} = {}) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const deps: RegistrarCobroLiquidacionDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
  };
  return { useCase: new RegistrarCobroLiquidacionUseCase(deps), repos, uow, deps };
};

const comando = (
  over: Partial<RegistrarCobroLiquidacionComando> = {},
): RegistrarCobroLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  importe: '4100.00',
  fechaCobro: '2026-06-15',
  ...over,
});

// ===========================================================================
// 3.4 — Happy path: crea PAGO, FACTURA.estado='cobrada',
//        liquidacion_status='cobrada', AUDIT_LOG crear+actualizar, respuesta.
// ===========================================================================

describe('RegistrarCobroLiquidacion — happy path (3.4)', () => {
  it('debe_crear_el_PAGO_con_factura_id_importe_y_fecha_cobro', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
    const args = repos.pagos.crear.mock.calls[0][0];
    expect(args.facturaId).toBe(FAC_LIQ_ID);
    expect(args.importe).toBe('4100.00');
    expect(args.fechaCobro).toEqual(new Date('2026-06-15'));
  });

  it('debe_transicionar_la_FACTURA_de_liquidacion_a_cobrada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.facturas.marcarCobrada).toHaveBeenCalledWith(
      expect.objectContaining({ idFactura: FAC_LIQ_ID, estado: 'cobrada' }),
    );
  });

  it('debe_avanzar_liquidacion_status_a_cobrada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarLiquidacionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, estado: 'cobrada' }),
    );
  });

  it('debe_registrar_AUDIT_LOG_crear_del_PAGO', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const crear = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear' && a.entidad === 'PAGO');
    expect(crear).toBeDefined();
    expect(crear.entidadId).toBe(NUEVO_PAGO_ID);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_de_FACTURA_y_RESERVA', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const actualizaciones = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .filter((a) => a.accion === 'actualizar');
    const entidades = actualizaciones.map((a) => a.entidad);
    expect(entidades).toEqual(expect.arrayContaining(['FACTURA', 'RESERVA']));
  });

  it('debe_devolver_pago_liquidacion_cobrada_y_liquidacionStatus_cobrada', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.pago.idPago).toBe(NUEVO_PAGO_ID);
    expect(resultado.pago.facturaId).toBe(FAC_LIQ_ID);
    expect(resultado.liquidacion.estado).toBe('cobrada');
    expect(resultado.liquidacionStatus).toBe('cobrada');
  });

  it('no_debe_devolver_alertaDiscrepancia_cuando_el_importe_coincide_con_el_total', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.alertaDiscrepancia == null).toBe(true);
  });

  it('debe_orquestar_todo_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });

  it('debe_releer_la_RESERVA_con_bloqueo_de_fila_dentro_de_la_transaccion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    // El FOR UPDATE sobre RESERVA es la fuente de verdad del estado (design.md §D-2).
    expect(repos.reservas.releerConBloqueo).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID }),
    );
  });
});

// ===========================================================================
// Scenario 10 — El cobro NO transiciona RESERVA.estado a evento_en_curso.
// ===========================================================================

describe('RegistrarCobroLiquidacion — el estado de la reserva no avanza a evento_en_curso', () => {
  it('no_debe_exponer_ningun_puerto_que_transicione_reserva_estado_a_evento_en_curso', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando());

    // El use-case solo avanza el sub-proceso liquidacion_status; nunca RESERVA.estado.
    expect(repos.reservas).not.toHaveProperty('avanzarEstado');
    // El resultado no anuncia transición del agregado (US-031 fuera de alcance).
    expect(resultado).not.toHaveProperty('estado');
    expect(resultado.liquidacionStatus).toBe('cobrada');
  });
});

// ===========================================================================
// 3.5 — Justificante opcional: sin documento → PAGO.justificanteDocId=NULL;
//        con documento → vincula el DOCUMENTO(justificante_pago) al PAGO.
// ===========================================================================

describe('RegistrarCobroLiquidacion — justificante opcional (3.5)', () => {
  it('debe_crear_el_PAGO_con_justificanteDocId_null_cuando_no_se_adjunta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    const args = repos.pagos.crear.mock.calls[0][0];
    expect(args.justificanteDocId == null).toBe(true);
  });

  it('debe_avanzar_igualmente_a_cobrada_sin_justificante', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(resultado.liquidacionStatus).toBe('cobrada');
    expect(repos.reservas.avanzarLiquidacionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'cobrada' }),
    );
  });

  it('no_debe_buscar_ningun_DOCUMENTO_justificante_cuando_no_se_adjunta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(repos.documentos.buscarJustificante).not.toHaveBeenCalled();
  });

  it('debe_vincular_el_DOCUMENTO_justificante_pago_al_PAGO_cuando_se_adjunta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ justificanteDocId: DOC_JUSTIF_ID }));

    // Se verifica que el DOCUMENTO existe en el tenant (RLS) y es del tipo esperado.
    expect(repos.documentos.buscarJustificante).toHaveBeenCalledWith(
      expect.objectContaining({ idDocumento: DOC_JUSTIF_ID, tenantId: TENANT }),
    );
    // El PAGO referencia el id_documento del justificante.
    const args = repos.pagos.crear.mock.calls[0][0];
    expect(args.justificanteDocId).toBe(DOC_JUSTIF_ID);
  });

  it('debe_rechazar_con_JustificanteNoEncontrado_cuando_el_doc_no_existe_en_el_tenant', async () => {
    // Multi-tenancy/RLS: un justificante inexistente en el tenant → 404.
    const { useCase, repos } = montar({ justificante: null });

    await expect(
      useCase.ejecutar(comando({ justificanteDocId: DOC_JUSTIF_ID })),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);
    expect(repos.pagos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.6 — Discrepancia de importe: crea PAGO con importe REAL, avanza a cobrada,
//        devuelve alertaDiscrepancia, la registra en AUDIT_LOG. NO bloquea.
// ===========================================================================

describe('RegistrarCobroLiquidacion — discrepancia de importe no bloquea (3.6)', () => {
  it('debe_crear_el_PAGO_con_el_importe_real_4000_de_una_factura_de_4100', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ importe: '4000.00' }));

    expect(repos.pagos.crear.mock.calls[0][0].importe).toBe('4000.00');
  });

  it('debe_avanzar_a_cobrada_pese_a_la_discrepancia', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ importe: '4000.00' }));

    expect(resultado.liquidacionStatus).toBe('cobrada');
    expect(repos.facturas.marcarCobrada).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'cobrada' }),
    );
  });

  it('debe_devolver_alertaDiscrepancia_facturado_cobrado_diferencia', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando({ importe: '4000.00' }));

    expect(resultado.alertaDiscrepancia).toEqual({
      importeFacturado: '4100.00',
      importeCobrado: '4000.00',
      diferencia: '100.00',
    });
  });

  it('debe_registrar_la_discrepancia_en_AUDIT_LOG', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ importe: '4000.00' }));

    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    // La discrepancia queda trazada (importe facturado y cobrado en el AUDIT_LOG).
    expect(trazas).toContain('4100.00');
    expect(trazas).toContain('4000.00');
  });
});

// ===========================================================================
// 3.8 — Bloqueos: precondición 'pendiente' y doble cobro 'cobrada'. En ambos
//        casos NO se crea PAGO ni se muta nada.
// ===========================================================================

describe('RegistrarCobroLiquidacion — bloqueo por precondición pendiente (3.8)', () => {
  it('debe_rechazar_con_LiquidacionNoFacturada_cuando_liquidacion_status_es_pendiente', async () => {
    const { useCase } = montar({ reservaBloqueada: reservaCobro({ liquidacionStatus: 'pendiente' }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(LiquidacionNoFacturadaError);
  });

  it('no_debe_crear_PAGO_ni_mutar_estado_cuando_esta_pendiente', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobro({ liquidacionStatus: 'pendiente' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(LiquidacionNoFacturadaError);
    expect(repos.pagos.crear).not.toHaveBeenCalled();
    expect(repos.facturas.marcarCobrada).not.toHaveBeenCalled();
    expect(repos.reservas.avanzarLiquidacionStatus).not.toHaveBeenCalled();
  });
});

describe('RegistrarCobroLiquidacion — bloqueo por doble cobro cobrada (3.8)', () => {
  it('debe_rechazar_con_LiquidacionYaCobrada_cuando_liquidacion_status_ya_es_cobrada', async () => {
    const { useCase } = montar({ reservaBloqueada: reservaCobro({ liquidacionStatus: 'cobrada' }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(LiquidacionYaCobradaError);
  });

  it('no_debe_crear_ningun_PAGO_adicional_en_el_doble_cobro', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobro({ liquidacionStatus: 'cobrada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(LiquidacionYaCobradaError);
    expect(repos.pagos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Reserva/factura inexistente (RLS): 404 sin mutar nada.
// ===========================================================================

describe('RegistrarCobroLiquidacion — reserva/factura inexistente (RLS)', () => {
  it('debe_rechazar_con_FacturaLiquidacionNoEncontrada_cuando_la_reserva_no_existe', async () => {
    const { useCase } = montar({ reservaBloqueada: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
  });

  it('debe_rechazar_con_FacturaLiquidacionNoEncontrada_cuando_no_hay_factura_de_liquidacion', async () => {
    const { useCase, repos } = montar({ liquidacion: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
    expect(repos.pagos.crear).not.toHaveBeenCalled();
  });
});
