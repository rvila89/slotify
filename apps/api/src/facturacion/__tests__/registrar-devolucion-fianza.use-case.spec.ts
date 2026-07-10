/**
 * TESTS del caso de uso `RegistrarDevolucionFianzaUseCase` (US-036 / UC-27 pasos 4-8) — fase TDD
 * RED. tasks.md Fase 3: 3.3 (happy path completa), 3.4 (parcial / retención total), 3.5 (importe >
 * fianza), 3.6 (fecha inválida), 3.7 (sin justificante), 3.8 (precondición triple), 3.9 (doble
 * registro). Paso SIMÉTRICO INVERSO de `registrar-cobro-fianza.use-case.spec.ts` (US-030), calcado
 * en estructura, ubicación y estilo.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma (hexagonal,
 * hook `no-infra-in-domain`). Fija la ORQUESTACIÓN atómica (design.md §D-1, patrón US-030): dentro
 * de UNA unidad de trabajo se relee la RESERVA con bloqueo de fila (`SELECT ... FOR UPDATE`, aquí
 * mockeado con `releerConBloqueo`), se lee `fianzaEur`/`fianzaCobradaFecha` para las validaciones y
 * el `iban_devolucion` del CLIENTE para la precondición triple, se evalúa la guarda de
 * precondición/doble registro, se valida importe/fecha/motivo, se deriva el estado final, se
 * vincula (si aplica) el DOCUMENTO del justificante, se hace `UPDATE RESERVA`
 * (`fianzaStatus`/`fianzaDevueltaEur`/`fianzaDevueltaFecha`/`motivoRetencion`) y se registra
 * AUDIT_LOG con `datos_anteriores`/`datos_nuevos`.
 *
 * La CONCURRENCIA REAL del `FOR UPDATE` (dos devoluciones simultáneas → una sola aplica) vive en
 * `registrar-devolucion-fianza-concurrencia.spec.ts` (transacción real contra Postgres). Aquí se
 * fija la lógica de orquestación con dobles.
 *
 * Trazabilidad: US-036, spec-delta `facturacion` (Requirements "Registro de la devolución …",
 * "Devolución parcial o retención total …", "Validación del importe …", "Validación de la fecha
 * …", "El justificante … es un DOCUMENTO opcional", "Precondición triple …", "Guarda contra el
 * doble registro …"). Contrato `registrarDevolucionFianza` (200; 400
 * IMPORTE_SUPERA_FIANZA/FECHA_DEVOLUCION_INVALIDA/MOTIVO_RETENCION_REQUERIDO; 404
 * JUSTIFICANTE_NO_ENCONTRADO; 409 PRECONDICION_NO_CUMPLIDA/DEVOLUCION_YA_REGISTRADA).
 *
 * RED: aún NO existe `facturacion/application/registrar-devolucion-fianza.use-case.ts`. El import
 * falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  RegistrarDevolucionFianzaUseCase,
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
  PrecondicionNoCumplidaError,
  DevolucionYaRegistradaError,
  ReservaDevolucionNoEncontradaError,
  JustificanteNoEncontradoError,
  type RegistrarDevolucionFianzaDeps,
  type RegistrarDevolucionFianzaComando,
  type ReservaDevolucionFianza,
  type DocumentoJustificante,
  type RepositoriosDevolucionFianza,
  type UnidadDeTrabajoDevolucionFianzaPort,
} from '../application/registrar-devolucion-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-post-36';
const CLIENTE_ID = 'cli-36';
const DOC_JUSTIF_ID = '11111111-1111-1111-1111-111111111111';
const USUARIO_ID = 'usr-gestor-36';
const IBAN = 'ES9121000418450200051332';

const FIANZA_COBRADA_FECHA = new Date('2026-05-15');

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en post_evento con fianza cobrada e IBAN de devolución.
// ---------------------------------------------------------------------------

const reservaDevolucion = (
  over: Partial<ReservaDevolucionFianza> = {},
): ReservaDevolucionFianza => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0036',
  estado: 'post_evento',
  fianzaStatus: 'cobrada',
  fianzaEur: '1000.00',
  fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
  ibanDevolucion: IBAN,
  ...over,
});

const documentoJustificante = (
  over: Partial<DocumentoJustificante> = {},
): DocumentoJustificante => ({
  idDocumento: DOC_JUSTIF_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  tipo: 'justificante_pago',
  mimeType: 'application/pdf',
  url: 'https://storage.local/justificantes/devolucion.pdf',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW. La relectura FOR UPDATE de la RESERVA la simula
// `reservas.releerConBloqueo`; el use-case evalúa la guarda con ese estado.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosDevolucionFianza {
  reservas: {
    releerConBloqueo: jest.Mock;
    registrarDevolucion: jest.Mock;
  };
  documentos: {
    buscarJustificante: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reservaBloqueada?: ReservaDevolucionFianza | null;
  justificante?: DocumentoJustificante | null;
} = {}): ReposFake => ({
  reservas: {
    releerConBloqueo: jest.fn(async () =>
      'reservaBloqueada' in opciones ? opciones.reservaBloqueada : reservaDevolucion(),
    ),
    registrarDevolucion: jest.fn(async () => undefined),
  },
  documentos: {
    buscarJustificante: jest.fn(async () =>
      'justificante' in opciones ? opciones.justificante : documentoJustificante(),
    ),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoDevolucionFianzaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosDevolucionFianza) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  reservaBloqueada?: ReservaDevolucionFianza | null;
  justificante?: DocumentoJustificante | null;
} = {}) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const deps: RegistrarDevolucionFianzaDeps = { unidadDeTrabajo: uow };
  return { useCase: new RegistrarDevolucionFianzaUseCase(deps), repos, uow, deps };
};

const comando = (
  over: Partial<RegistrarDevolucionFianzaComando> = {},
): RegistrarDevolucionFianzaComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  importeDevuelto: '1000.00',
  fechaCobro: '2026-06-05',
  ...over,
});

// ===========================================================================
// 3.3 — Happy path (devolución completa): set fianza_devuelta_eur/fecha,
//        fianza_status='devuelta', AUDIT_LOG con datos_anteriores/nuevos.
// ===========================================================================

describe('RegistrarDevolucionFianza — happy path devolución completa (3.3)', () => {
  it('debe_registrar_la_devolucion_con_estado_devuelta_importe_y_fecha', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.registrarDevolucion).toHaveBeenCalledTimes(1);
    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.fianzaStatus).toBe('devuelta');
    expect(args.fianzaDevueltaEur).toBe('1000.00');
    expect(args.fianzaDevueltaFecha).toEqual(new Date('2026-06-05'));
  });

  it('no_debe_persistir_motivo_de_retencion_en_devolucion_completa', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ motivoRetencion: 'irrelevante en completa' }));

    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    // En 'devuelta' el motivo se ignora / queda null (contrato + spec-delta).
    expect(args.motivoRetencion == null).toBe(true);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_de_RESERVA_con_datos_anteriores_y_nuevos', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const actualizar = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'actualizar' && a.entidad === 'RESERVA');
    expect(actualizar).toBeDefined();
    expect(actualizar.entidadId).toBe(RESERVA_ID);
    expect(actualizar.datosAnteriores).toEqual(
      expect.objectContaining({
        fianzaStatus: 'cobrada',
        fianzaDevueltaEur: null,
        fianzaDevueltaFecha: null,
      }),
    );
    expect(actualizar.datosNuevos).toEqual(
      expect.objectContaining({
        fianzaStatus: 'devuelta',
        fianzaDevueltaEur: '1000.00',
      }),
    );
  });

  it('debe_devolver_reserva_con_fianzaStatus_devuelta_y_avisoSinJustificante_false_con_justificante', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: DOC_JUSTIF_ID }));

    expect(resultado.reserva.fianzaStatus).toBe('devuelta');
    expect(resultado.reserva.fianzaDevueltaEur).toBe('1000.00');
    expect(resultado.reserva.fianzaDevueltaFecha).toBe('2026-06-05');
    expect(resultado.avisoSinJustificante).toBe(false);
    expect(resultado.documentoJustificante?.idDocumento).toBe(DOC_JUSTIF_ID);
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

    // El FOR UPDATE sobre RESERVA es la fuente de verdad del estado (design.md §D-1/§D-4).
    expect(repos.reservas.releerConBloqueo).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID }),
    );
  });

  it('no_debe_transicionar_reserva_estado_solo_avanza_el_sub_proceso_fianza', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando());

    // El use-case solo avanza fianza_status; nunca RESERVA.estado.
    expect(repos.reservas).not.toHaveProperty('avanzarEstado');
    expect(resultado.reserva.fianzaStatus).toBe('devuelta');
  });
});

// ===========================================================================
// 3.4 — FA-01 devolución parcial y retención total: fianza_status='retenida_parcial',
//        motivo persistido, DOCUMENTO opcional.
// ===========================================================================

describe('RegistrarDevolucionFianza — FA-01 devolución parcial con motivo (3.4)', () => {
  it('debe_derivar_retenida_parcial_y_persistir_el_motivo_de_retencion', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaEur: '1500.00' }),
    });

    const resultado = await useCase.ejecutar(
      comando({
        importeDevuelto: '1000.00',
        motivoRetencion: 'Daños en vajilla valorados en 500 €',
        fechaCobro: '2026-06-06',
      }),
    );

    expect(resultado.reserva.fianzaStatus).toBe('retenida_parcial');
    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    expect(args.fianzaStatus).toBe('retenida_parcial');
    expect(args.fianzaDevueltaEur).toBe('1000.00');
    expect(args.fianzaDevueltaFecha).toEqual(new Date('2026-06-06'));
    expect(args.motivoRetencion).toBe('Daños en vajilla valorados en 500 €');
  });

  it('debe_reflejar_el_motivo_de_retencion_en_AUDIT_LOG_datos_nuevos', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaEur: '1500.00' }),
    });

    await useCase.ejecutar(
      comando({ importeDevuelto: '1000.00', motivoRetencion: 'Daños', fechaCobro: '2026-06-06' }),
    );

    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    expect(trazas).toContain('retenida_parcial');
    expect(trazas).toContain('Daños');
  });

  it('debe_aceptar_la_retencion_total_importe_0_00_como_retenida_parcial', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaEur: '1000.00' }),
    });

    const resultado = await useCase.ejecutar(
      comando({
        importeDevuelto: '0.00',
        motivoRetencion: 'Fianza retenida íntegramente por desperfectos',
        fechaCobro: '2026-06-06',
      }),
    );

    expect(resultado.reserva.fianzaStatus).toBe('retenida_parcial');
    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    expect(args.fianzaDevueltaEur).toBe('0.00');
  });

  it('debe_rechazar_con_MotivoRetencionRequerido_cuando_es_parcial_sin_motivo_sin_mutar', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaEur: '1500.00' }),
    });

    await expect(
      useCase.ejecutar(comando({ importeDevuelto: '1000.00', fechaCobro: '2026-06-06' })),
    ).rejects.toBeInstanceOf(MotivoRetencionRequeridoError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.5 — FA-02 importe > fianza_eur ⇒ error, sin mutación ni DOCUMENTO.
// ===========================================================================

describe('RegistrarDevolucionFianza — FA-02 importe supera la fianza (3.5)', () => {
  it('debe_rechazar_con_ImporteSuperaFianza_cuando_el_importe_supera_la_fianza', async () => {
    const { useCase } = montar();

    await expect(
      useCase.ejecutar(comando({ importeDevuelto: '1500.00' })),
    ).rejects.toBeInstanceOf(ImporteSuperaFianzaError);
  });

  it('no_debe_mutar_la_RESERVA_ni_vincular_DOCUMENTO_cuando_el_importe_supera_la_fianza', async () => {
    const { useCase, repos } = montar();

    await expect(
      useCase.ejecutar(comando({ importeDevuelto: '1500.00', justificanteDocId: DOC_JUSTIF_ID })),
    ).rejects.toBeInstanceOf(ImporteSuperaFianzaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.6 — FA-03 fecha_cobro < fianza_cobrada_fecha ⇒ error, sin mutación.
// ===========================================================================

describe('RegistrarDevolucionFianza — FA-03 fecha anterior al cobro de fianza (3.6)', () => {
  it('debe_rechazar_con_FechaDevolucionInvalida_cuando_la_fecha_es_anterior_al_cobro', async () => {
    const { useCase } = montar();

    await expect(
      useCase.ejecutar(comando({ fechaCobro: '2026-05-10' })),
    ).rejects.toBeInstanceOf(FechaDevolucionInvalidaError);
  });

  it('no_debe_mutar_la_RESERVA_cuando_la_fecha_es_invalida', async () => {
    const { useCase, repos } = montar();

    await expect(
      useCase.ejecutar(comando({ fechaCobro: '2026-05-10' })),
    ).rejects.toBeInstanceOf(FechaDevolucionInvalidaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — FA-04 sin justificante: estado final aplicado, sin DOCUMENTO, aviso true.
// ===========================================================================

describe('RegistrarDevolucionFianza — FA-04 registro sin justificante (3.7)', () => {
  it('debe_registrar_la_devolucion_igualmente_con_avisoSinJustificante_true', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(resultado.avisoSinJustificante).toBe(true);
    expect(resultado.reserva.fianzaStatus).toBe('devuelta');
    expect(repos.reservas.registrarDevolucion).toHaveBeenCalledTimes(1);
  });

  it('no_debe_devolver_documentoJustificante_cuando_no_se_adjunta', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(resultado.documentoJustificante == null).toBe(true);
  });

  it('no_debe_buscar_ningun_DOCUMENTO_justificante_cuando_no_se_adjunta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ justificanteDocId: undefined }));

    expect(repos.documentos.buscarJustificante).not.toHaveBeenCalled();
  });

  it('debe_vincular_el_DOCUMENTO_justificante_pago_cuando_se_adjunta_y_avisar_false', async () => {
    const { useCase, repos } = montar();

    const resultado = await useCase.ejecutar(comando({ justificanteDocId: DOC_JUSTIF_ID }));

    expect(repos.documentos.buscarJustificante).toHaveBeenCalledWith(
      expect.objectContaining({ idDocumento: DOC_JUSTIF_ID, tenantId: TENANT }),
    );
    expect(resultado.avisoSinJustificante).toBe(false);
    expect(resultado.documentoJustificante?.tipo).toBe('justificante_pago');
  });
});

// ===========================================================================
// Multi-tenancy — justificante inexistente en el tenant → 404.
// ===========================================================================

describe('RegistrarDevolucionFianza — justificante inexistente en el tenant (RLS)', () => {
  it('debe_rechazar_con_JustificanteNoEncontrado_cuando_el_doc_no_existe_en_el_tenant', async () => {
    const { useCase, repos } = montar({ justificante: null });

    await expect(
      useCase.ejecutar(comando({ justificanteDocId: DOC_JUSTIF_ID })),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.8 — Precondición triple incumplida ⇒ PRECONDICION_NO_CUMPLIDA (409), sin mutar.
// ===========================================================================

describe('RegistrarDevolucionFianza — precondición triple incumplida (3.8)', () => {
  it('debe_rechazar_con_PrecondicionNoCumplida_cuando_no_esta_en_post_evento', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ estado: 'evento_en_curso' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(PrecondicionNoCumplidaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_PrecondicionNoCumplida_cuando_la_fianza_no_esta_cobrada', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaStatus: 'recibo_enviado' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(PrecondicionNoCumplidaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_PrecondicionNoCumplida_cuando_el_cliente_no_tiene_iban_devolucion', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ ibanDevolucion: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(PrecondicionNoCumplidaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.9 — Doble registro sobre estado final ⇒ DEVOLUCION_YA_REGISTRADA (irreversible).
// ===========================================================================

describe('RegistrarDevolucionFianza — doble registro / irreversibilidad (3.9)', () => {
  it('debe_rechazar_con_DevolucionYaRegistrada_cuando_ya_esta_devuelta', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaStatus: 'devuelta' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(DevolucionYaRegistradaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_DevolucionYaRegistrada_cuando_ya_esta_retenida_parcial', async () => {
    const { useCase, repos } = montar({
      reservaBloqueada: reservaDevolucion({ fianzaStatus: 'retenida_parcial' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(DevolucionYaRegistradaError);
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 — Reserva inexistente (RLS): 404 sin mutar nada.
// ===========================================================================

describe('RegistrarDevolucionFianza — reserva inexistente (RLS)', () => {
  it('debe_rechazar_con_ReservaDevolucionNoEncontrada_cuando_la_reserva_no_existe', async () => {
    const { useCase } = montar({ reservaBloqueada: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaDevolucionNoEncontradaError,
    );
  });

  it('no_debe_mutar_nada_cuando_la_reserva_no_existe', async () => {
    const { useCase, repos } = montar({ reservaBloqueada: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaDevolucionNoEncontradaError,
    );
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});
