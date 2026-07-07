/**
 * TESTS del caso de uso `RegistrarCobroFianzaUseCase` (US-030 / UC-22 pasos 5-9) — fase TDD RED.
 * tasks.md Fase 3: 3.3 (registro del cobro), 3.4 (justificante opcional), 3.5 (cobro en T-0),
 * 3.6 (política "Negociable" + D-2b), 3.8 (bloqueo de doble cobro).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma (hexagonal,
 * hook `no-infra-in-domain`). Aquí se fija la ORQUESTACIÓN atómica (design.md §D-1, patrón
 * US-029 opción A): dentro de UNA unidad de trabajo se relee la RESERVA con bloqueo de fila
 * (`SELECT ... FOR UPDATE`, aquí mockeado), se lee su `fecha_evento` para la validación, se
 * evalúa la guarda de precondición/doble cobro/Negociable, se crea (si aplica) el DOCUMENTO del
 * justificante, se crea el PAGO, se transiciona `FACTURA(fianza).estado='cobrada'` +
 * `RESERVA.fianza_status='cobrada'` + se registran `fianza_eur`/`fianza_cobrada_fecha` y se
 * registra AUDIT_LOG.
 *
 * La CONCURRENCIA REAL del `FOR UPDATE` (dos cobros simultáneos → un único PAGO) vive en
 * `registrar-cobro-fianza-concurrencia.spec.ts` (transacción real contra Postgres). Aquí se fija
 * la lógica de orquestación con dobles.
 *
 * Trazabilidad: US-030, spec-delta `facturacion` (Requirements "Registro del cobro de la
 * fianza…", "El justificante de pago de la fianza es opcional", "El cobro de la fianza se admite
 * en cualquier fecha hasta el día del evento", "Guarda contra el doble cobro de la fianza",
 * "Política Negociable — el cobro con fianza pendiente avisa pero no bloquea"). Contrato:
 * `registrarCobroFianza` (200 `cobrado`/`confirmacion_requerida`; 409 `FIANZA_YA_COBRADA`; 400
 * `COBRO_INVALIDO`; 404 `FACTURA_FIANZA_NO_ENCONTRADA`/`JUSTIFICANTE_NO_ENCONTRADO`).
 *
 * RED: aún NO existe `facturacion/application/registrar-cobro-fianza.use-case.ts`. El import
 * falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  RegistrarCobroFianzaUseCase,
  FianzaYaCobradaError,
  FacturaFianzaNoEncontradaError,
  JustificanteNoEncontradoError,
  type RegistrarCobroFianzaDeps,
  type RegistrarCobroFianzaComando,
  type FacturaFianzaCobrable,
  type ReservaCobroFianza,
  type DocumentoJustificante,
  type RepositoriosCobroFianza,
  type UnidadDeTrabajoCobroFianzaPort,
} from '../application/registrar-cobro-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-30';
const CLIENTE_ID = 'cli-30';
const FAC_FIANZA_ID = 'fac-fianza-1';
const DOC_JUSTIF_ID = '11111111-1111-1111-1111-111111111111';
const USUARIO_ID = 'usr-gestor-30';
const NUEVO_PAGO_ID = 'pago-fianza-1';
const NUEVA_FACTURA_ID = 'fac-fianza-alvuelo-1';

const FECHA_EVENTO = new Date('2026-07-12');

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(fianza) 'enviada' y RESERVA 'recibo_enviado'.
// ---------------------------------------------------------------------------

const facturaFianza = (over: Partial<FacturaFianzaCobrable> = {}): FacturaFianzaCobrable => ({
  idFactura: FAC_FIANZA_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: 'F-2026-0300',
  tipo: 'fianza',
  estado: 'enviada',
  total: '1000.00',
  ...over,
});

const reservaCobroFianza = (over: Partial<ReservaCobroFianza> = {}): ReservaCobroFianza => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0030',
  estado: 'reserva_confirmada',
  fianzaStatus: 'recibo_enviado',
  fechaEvento: FECHA_EVENTO,
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

interface ReposFake extends RepositoriosCobroFianza {
  facturas: {
    buscarFianzaPorReserva: jest.Mock;
    crearFacturaFianza: jest.Mock;
    marcarCobrada: jest.Mock;
  };
  reservas: {
    releerConBloqueo: jest.Mock;
    avanzarFianzaStatus: jest.Mock;
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
  fianza?: FacturaFianzaCobrable | null;
  reservaBloqueada?: ReservaCobroFianza | null;
  justificante?: DocumentoJustificante | null;
} = {}): ReposFake => ({
  facturas: {
    buscarFianzaPorReserva: jest.fn(async () =>
      'fianza' in opciones ? opciones.fianza : facturaFianza(),
    ),
    crearFacturaFianza: jest.fn(async (f: Record<string, unknown>) => ({
      idFactura: NUEVA_FACTURA_ID,
      estado: 'cobrada',
      ...f,
    })),
    marcarCobrada: jest.fn(async () => undefined),
  },
  reservas: {
    releerConBloqueo: jest.fn(async () =>
      'reservaBloqueada' in opciones ? opciones.reservaBloqueada : reservaCobroFianza(),
    ),
    avanzarFianzaStatus: jest.fn(async () => undefined),
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
): UnidadDeTrabajoCobroFianzaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosCobroFianza) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  fianza?: FacturaFianzaCobrable | null;
  reservaBloqueada?: ReservaCobroFianza | null;
  justificante?: DocumentoJustificante | null;
} = {}) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const deps: RegistrarCobroFianzaDeps = { unidadDeTrabajo: uow };
  return { useCase: new RegistrarCobroFianzaUseCase(deps), repos, uow, deps };
};

const comando = (
  over: Partial<RegistrarCobroFianzaComando> = {},
): RegistrarCobroFianzaComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  importe: '1000.00',
  fechaCobro: '2026-07-10',
  ...over,
});

// ===========================================================================
// 3.3 — Happy path: crea PAGO (factura_id/importe/fecha_cobro),
//        FACTURA.estado='cobrada', fianza_status='cobrada', fianza_eur=importe,
//        fianza_cobrada_fecha=fecha_cobro, AUDIT_LOG crear+actualizar.
// ===========================================================================

describe('RegistrarCobroFianza — happy path (3.3)', () => {
  it('debe_crear_el_PAGO_con_factura_id_importe_y_fecha_cobro', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
    const args = repos.pagos.crear.mock.calls[0][0];
    expect(args.facturaId).toBe(FAC_FIANZA_ID);
    expect(args.importe).toBe('1000.00');
    expect(args.fechaCobro).toEqual(new Date('2026-07-10'));
  });

  it('debe_transicionar_la_FACTURA_de_fianza_a_cobrada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.facturas.marcarCobrada).toHaveBeenCalledWith(
      expect.objectContaining({ idFactura: FAC_FIANZA_ID, estado: 'cobrada' }),
    );
  });

  it('debe_avanzar_fianza_status_a_cobrada_y_registrar_fianza_eur_y_fianza_cobrada_fecha', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarFianzaStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        estado: 'cobrada',
        fianzaEur: '1000.00',
        fianzaCobradaFecha: new Date('2026-07-10'),
      }),
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

  it('debe_devolver_pago_facturaFianza_cobrada_fianzaStatus_cobrada_y_fianza_eur_fecha', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.resultado).toBe('cobrado');
    if (resultado.resultado === 'cobrado') {
      expect(resultado.pago.idPago).toBe(NUEVO_PAGO_ID);
      expect(resultado.pago.facturaId).toBe(FAC_FIANZA_ID);
      expect(resultado.facturaFianza.estado).toBe('cobrada');
      expect(resultado.fianzaStatus).toBe('cobrada');
      expect(resultado.fianzaEur).toBe('1000.00');
      expect(resultado.fianzaCobradaFecha).toBe('2026-07-10');
    }
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

    // El FOR UPDATE sobre RESERVA es la fuente de verdad del estado (design.md §D-1).
    expect(repos.reservas.releerConBloqueo).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID }),
    );
  });
});

// ===========================================================================
// Scenario — el cobro de fianza NO transiciona RESERVA.estado a evento_en_curso.
// ===========================================================================

describe('RegistrarCobroFianza — el estado de la reserva no avanza a evento_en_curso', () => {
  it('no_debe_exponer_ningun_puerto_que_transicione_reserva_estado_a_evento_en_curso', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando());

    // El use-case solo avanza el sub-proceso fianza_status; nunca RESERVA.estado (US-031).
    expect(repos.reservas).not.toHaveProperty('avanzarEstado');
    expect(resultado.resultado).toBe('cobrado');
    if (resultado.resultado === 'cobrado') {
      expect(resultado.fianzaStatus).toBe('cobrada');
    }
  });
});

// ===========================================================================
// 3.4 — Justificante opcional: sin documento → PAGO.justificanteDocId=NULL;
//        con documento → vincula el DOCUMENTO(justificante_pago) al PAGO.
// ===========================================================================

describe('RegistrarCobroFianza — justificante opcional (3.4)', () => {
  it('debe_crear_el_PAGO_con_justificanteDocId_null_cuando_no_se_adjunta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    const args = repos.pagos.crear.mock.calls[0][0];
    expect(args.justificanteDocId == null).toBe(true);
  });

  it('debe_avanzar_igualmente_a_cobrada_sin_justificante', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(resultado.resultado).toBe('cobrado');
    expect(repos.reservas.avanzarFianzaStatus).toHaveBeenCalledWith(
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
// 3.5 — Cobro en T-0: fecha_cobro = fecha_evento se acepta como el happy path.
// ===========================================================================

describe('RegistrarCobroFianza — cobro en T-0 (3.5)', () => {
  it('debe_aceptar_el_cobro_con_fecha_cobro_igual_a_la_fecha_del_evento', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ fechaCobro: '2026-07-12' }));

    expect(resultado.resultado).toBe('cobrado');
    if (resultado.resultado === 'cobrado') {
      expect(resultado.fianzaStatus).toBe('cobrada');
      expect(resultado.fianzaCobradaFecha).toBe('2026-07-12');
    }
    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
    expect(repos.pagos.crear.mock.calls[0][0].fechaCobro).toEqual(new Date('2026-07-12'));
  });

  it('no_debe_diferir_del_happy_path_en_T0_marcando_la_FACTURA_cobrada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ fechaCobro: '2026-07-12' }));

    expect(repos.facturas.marcarCobrada).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'cobrada' }),
    );
  });
});

// ===========================================================================
// 3.6 — Política "Negociable": pendiente sin confirmarSinRecibo → pide
//        confirmación (NO crea PAGO); con confirmarSinRecibo=true → registra y
//        traza el flujo excepcional en AUDIT_LOG. Incluye D-2(b): FACTURA en
//        borrador salta a cobrada; sin FACTURA se crea al vuelo y se marca cobrada.
// ===========================================================================

describe('RegistrarCobroFianza — Negociable: pendiente sin confirmar pide confirmación (3.6)', () => {
  it('debe_devolver_confirmacion_requerida_sin_crear_PAGO_cuando_pendiente_y_sin_flag', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    const resultado = await useCase.ejecutar(comando({ confirmarSinRecibo: false }));

    expect(resultado.resultado).toBe('confirmacion_requerida');
    if (resultado.resultado === 'confirmacion_requerida') {
      expect(resultado.codigo).toBe('RECIBO_FIANZA_NO_ENVIADO');
      expect(resultado.mensaje).toContain('no ha sido enviado al cliente');
    }
    expect(repos.pagos.crear).not.toHaveBeenCalled();
    expect(repos.facturas.marcarCobrada).not.toHaveBeenCalled();
    expect(repos.reservas.avanzarFianzaStatus).not.toHaveBeenCalled();
  });

  it('no_debe_crear_FACTURA_ni_cambiar_estado_en_la_confirmacion_requerida', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    await useCase.ejecutar(comando({ confirmarSinRecibo: false }));

    expect(repos.facturas.crearFacturaFianza).not.toHaveBeenCalled();
  });
});

describe('RegistrarCobroFianza — Negociable confirmado con FACTURA(fianza) en enviada (3.6)', () => {
  it('debe_registrar_el_cobro_y_trazar_el_flujo_excepcional_en_AUDIT_LOG_cuando_confirma', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    const resultado = await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    expect(resultado.resultado).toBe('cobrado');
    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
    if (resultado.resultado === 'cobrado') {
      expect(resultado.fianzaStatus).toBe('cobrada');
    }
    // La traza del flujo excepcional (cobro sobre fianza no enviada) queda en AUDIT_LOG.
    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    expect(trazas.toLowerCase()).toContain('no enviad');
  });
});

// --- D-2(b) primer caso: FACTURA(fianza) en borrador salta directamente a cobrada. ---

describe('RegistrarCobroFianza — D-2b: FACTURA(fianza) en borrador salta a cobrada (3.6)', () => {
  it('debe_transicionar_la_FACTURA_borrador_directamente_a_cobrada_sin_pasar_por_enviada', async () => {
    const { useCase, repos } = montar({
      fianza: facturaFianza({ estado: 'borrador' }),
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    const resultado = await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    expect(resultado.resultado).toBe('cobrado');
    // borrador → cobrada (sin crear una factura nueva: la existente se marca cobrada).
    expect(repos.facturas.crearFacturaFianza).not.toHaveBeenCalled();
    expect(repos.facturas.marcarCobrada).toHaveBeenCalledWith(
      expect.objectContaining({ idFactura: FAC_FIANZA_ID, estado: 'cobrada' }),
    );
    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
  });

  it('debe_documentar_el_salto_de_estado_de_la_FACTURA_en_AUDIT_LOG', async () => {
    const { useCase, repos } = montar({
      fianza: facturaFianza({ estado: 'borrador' }),
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    // Se traza el salto de estado de la FACTURA (borrador → cobrada) además del cobro.
    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    expect(trazas).toContain('borrador');
    expect(trazas).toContain('cobrada');
  });
});

// --- D-2(b) segundo caso: sin FACTURA(fianza) → crear al vuelo y marcar cobrada. ---

describe('RegistrarCobroFianza — D-2b: sin FACTURA(fianza) se crea al vuelo cobrada (3.6)', () => {
  it('debe_crear_la_FACTURA_de_fianza_al_vuelo_y_marcarla_cobrada_cuando_no_existe', async () => {
    const { useCase, repos } = montar({
      fianza: null,
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    const resultado = await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    expect(resultado.resultado).toBe('cobrado');
    expect(repos.facturas.crearFacturaFianza).toHaveBeenCalledTimes(1);
    expect(repos.facturas.crearFacturaFianza).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, tenantId: TENANT, tipo: 'fianza' }),
    );
    // El PAGO se concilia contra la factura creada al vuelo.
    expect(repos.pagos.crear).toHaveBeenCalledTimes(1);
    expect(repos.pagos.crear.mock.calls[0][0].facturaId).toBe(NUEVA_FACTURA_ID);
  });

  it('debe_registrar_en_AUDIT_LOG_la_creacion_de_la_FACTURA_al_vuelo', async () => {
    const { useCase, repos } = montar({
      fianza: null,
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    const crearFactura = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'crear' && a.entidad === 'FACTURA');
    expect(crearFactura).toBeDefined();
    expect(crearFactura.entidadId).toBe(NUEVA_FACTURA_ID);
  });

  it('debe_avanzar_fianza_status_a_cobrada_con_la_factura_creada_al_vuelo', async () => {
    const { useCase, repos } = montar({
      fianza: null,
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'pendiente' }),
    });

    const resultado = await useCase.ejecutar(comando({ confirmarSinRecibo: true }));

    if (resultado.resultado === 'cobrado') {
      expect(resultado.fianzaStatus).toBe('cobrada');
    }
    expect(repos.reservas.avanzarFianzaStatus).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'cobrada' }),
    );
  });
});

// ===========================================================================
// 3.8 — Bloqueo de doble cobro: 'cobrada' bloquea con "La fianza ya está marcada
//        como cobrada"; ningún PAGO creado.
// ===========================================================================

describe('RegistrarCobroFianza — bloqueo por doble cobro cobrada (3.8)', () => {
  it('debe_rechazar_con_FianzaYaCobrada_cuando_fianza_status_ya_es_cobrada', async () => {
    const { useCase } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'cobrada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FianzaYaCobradaError);
  });

  it('debe_exponer_el_mensaje_la_fianza_ya_esta_marcada_como_cobrada', async () => {
    const { useCase } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'cobrada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toThrow(
      'La fianza ya está marcada como cobrada',
    );
  });

  it('no_debe_crear_ningun_PAGO_adicional_en_el_doble_cobro', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'cobrada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FianzaYaCobradaError);
    expect(repos.pagos.crear).not.toHaveBeenCalled();
    expect(repos.facturas.marcarCobrada).not.toHaveBeenCalled();
    expect(repos.reservas.avanzarFianzaStatus).not.toHaveBeenCalled();
  });

  it('debe_bloquear_el_doble_cobro_aunque_venga_confirmarSinRecibo_true', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaCobroFianza({ fianzaStatus: 'cobrada' }),
    });

    await expect(
      useCase.ejecutar(comando({ confirmarSinRecibo: true })),
    ).rejects.toBeInstanceOf(FianzaYaCobradaError);
    expect(repos.pagos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 — Reserva/factura inexistente (RLS): 404 sin mutar nada.
// ===========================================================================

describe('RegistrarCobroFianza — reserva inexistente (RLS)', () => {
  it('debe_rechazar_con_FacturaFianzaNoEncontrada_cuando_la_reserva_no_existe', async () => {
    const { useCase } = montar({ reservaBloqueada: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaFianzaNoEncontradaError,
    );
  });

  it('no_debe_crear_PAGO_cuando_la_reserva_no_existe', async () => {
    const { useCase, repos } = montar({ reservaBloqueada: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaFianzaNoEncontradaError,
    );
    expect(repos.pagos.crear).not.toHaveBeenCalled();
  });
});
