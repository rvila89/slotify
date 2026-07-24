/**
 * TESTS del caso de uso `FinalizarEventoUseCase` (UC-25 / US-034) — fase TDD RED.
 * tasks.md Fase 3: 3.3 (happy path con fianza), 3.4 (sin fianza), 3.5 (dato anómalo),
 * 3.6 (fallo de E5 — transición y envío separados), 3.7 (conflicto de estado),
 * 3.8 (advertencia no bloqueante de checklist).
 *
 * Trazabilidad: US-034; spec-delta `consultas` (guarda de origen `evento_en_curso →
 * post_evento`, auditoría origen Usuario, advertencia no bloqueante de checklist) y
 * spec-delta `comunicaciones` (E5 condicionado a `fianza_eur > 0`, NULL/0 == sin fianza,
 * alerta de dato anómalo, transición↔envío separados, NPS programada). Contrato congelado
 * `docs/api-spec.yml` op `finalizarEvento`:
 *   - 200 `FinalizarEventoResponse`: RESERVA en `post_evento` + `e5: { resultado:
 *     enviado|fallido|no_aplica, comunicacionId }` + `documentacionPendiente: string[]`.
 *   - 409 `code: transicion_no_permitida` cuando `estado != evento_en_curso`.
 *   - 404 RESERVA inexistente / de otro tenant.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD, la concurrencia y el
 * `SELECT … FOR UPDATE` REALES viven en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`;
 * aquí se fija la ORQUESTACIÓN (design.md §D-2/§D-9):
 *   1. Paso transaccional: re-evalúa la guarda de origen, transiciona a `post_evento`,
 *      AUDIT_LOG `accion='transicion'` origen Usuario, marca NPS programada, y —si
 *      `fianzaStatus='cobrada' && fianzaEur IS NULL`— la alerta de dato anómalo.
 *   2. Paso post-commit (best-effort): SOLO si `debeEnviarseE5(fianzaEur)` invoca el motor
 *      de E5; un fallo del proveedor deja `resultado='fallido'` SIN revertir la transición.
 *   3. Consulta ítems de documentación pendientes (fail-open) para la advertencia.
 *
 * RED: aún NO existe `reservas/application/finalizar-evento.use-case.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  FinalizarEventoUseCase,
  ReservaNoEncontradaError,
  TransicionNoPermitidaError,
  type FinalizarEventoDeps,
  type FinalizarEventoComando,
  type ReservaFinalizacion,
  type ReservaHidratadaFinalizacion,
  type RepositoriosFinalizacion,
  type UnidadDeTrabajoFinalizacionPort,
  type DispararE5Port,
  type DocumentacionEventoPort,
  type ResultadoDispararE5,
} from '../application/finalizar-evento.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-evento';
const CLIENTE_ID = 'cli-1';

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en evento_en_curso con matriz de fianza.
// ---------------------------------------------------------------------------

const reservaEnCurso = (
  over: Partial<ReservaFinalizacion> = {},
): ReservaFinalizacion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'evento_en_curso',
  subEstado: null,
  fianzaEur: '1000.00',
  fianzaStatus: 'cobrada',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW fake. El use-case orquesta la tx de transición.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosFinalizacion {
  reservas: { finalizarEvento: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  reservas: {
    // El adaptador real hace `UPDATE … WHERE estado='evento_en_curso'` bajo el lock y
    // devuelve el número de filas afectadas (0 => la guarda ya no se cumple bajo el lock).
    finalizarEvento: jest.fn(async () => ({ filasAfectadas: 1 })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

/**
 * UoW fake: ejecuta el trabajo con los repos fake. Si `filasAfectadas` del repo es 0,
 * el use-case debe abortar la transición como conflicto (doble finalización / estado ya
 * cambiado bajo el lock); esa vertiente se prueba en `…-concurrencia.spec.ts`.
 */
const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoFinalizacionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(async (_tenantId: string, trabajo: (r: RepositoriosFinalizacion) => Promise<unknown>) =>
    trabajo(repos),
  ),
});

const crearDispararE5Fake = (
  resultado: ResultadoDispararE5,
): DispararE5Port & { disparar: jest.Mock } => ({
  disparar: jest.fn(async () => resultado),
});

/**
 * RESERVA COMPLETA re-leída POST-COMMIT (misma proyección que GET /reservas/{id}) que hidrata
 * el `allOf(Reserva)` de la respuesta 200. Ya en `post_evento` (estado tras el commit).
 */
const reservaHidratada = (
  over: Partial<ReservaHidratadaFinalizacion> = {},
): ReservaHidratadaFinalizacion => ({
  idReserva: RESERVA_ID,
  codigo: 'SLO-2026-0034',
  clienteId: CLIENTE_ID,
  estado: 'post_evento',
  subEstado: null,
  canalEntrada: 'email',
  fechaEvento: new Date('2026-06-20T00:00:00.000Z'),
  duracionHoras: 8,
  tipoEvento: 'boda',
  numAdultosNinosMayores4: 80,
  numNinosMenores4: 5,
  numInvitadosFinal: 85,
  importeTotal: '3000.00',
  importeSenal: '1200.00',
  importeLiquidacion: '1800.00',
  ttlExpiracion: null,
  visitaProgramadaFecha: null,
  visitaProgramadaHora: null,
  visitaRealizada: null,
  fianzaEur: '1000.00',
  fianzaCobradaFecha: null,
  fianzaDevueltaFecha: null,
  fianzaComprobanteFecha: null,
  condPartFirmadas: null,
  condPartFechaEnvio: null,
  condPartFechaFirma: null,
  preEventoStatus: 'cerrado',
  liquidacionStatus: 'cobrada',
  fianzaStatus: 'cobrada',
  posicionCola: null,
  consultaBloqueanteId: null,
  notas: null,
  comentarios: null,
  fechaCreacion: new Date('2026-01-10T09:00:00.000Z'),
  cliente: {
    idCliente: CLIENTE_ID,
    nombre: 'Ada',
    apellidos: 'Lovelace',
    email: 'ada@us034.test',
    telefono: null,
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
  },
  ...over,
});

const crearCargarReservaDetalleFake = (
  reserva: ReservaHidratadaFinalizacion | null,
): { cargar: jest.Mock } => ({
  cargar: jest.fn(async () => reserva),
});

const crearDocumentacionFake = (
  itemsPendientes: string[],
): DocumentacionEventoPort & { itemsPendientes: jest.Mock } => ({
  itemsPendientes: jest.fn(async () => itemsPendientes),
});

interface Escenario {
  deps: FinalizarEventoDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
  e5: ReturnType<typeof crearDispararE5Fake>;
  documentacion: ReturnType<typeof crearDocumentacionFake>;
  detalle: ReturnType<typeof crearCargarReservaDetalleFake>;
}

const construir = (opciones: {
  reserva?: ReservaFinalizacion | null;
  reservaDetalle?: ReservaHidratadaFinalizacion | null;
  resultadoE5?: ResultadoDispararE5;
  itemsPendientes?: string[];
} = {}): Escenario => {
  const repos = crearReposFake();
  const uow = crearUoWFake(repos);
  const e5 = crearDispararE5Fake(
    opciones.resultadoE5 ?? { resultado: 'enviado', comunicacionId: 'com-e5-1' },
  );
  const documentacion = crearDocumentacionFake(opciones.itemsPendientes ?? []);
  const reserva =
    opciones.reserva === undefined ? reservaEnCurso() : opciones.reserva;
  // La relectura post-commit devuelve la RESERVA COMPLETA (ya en post_evento) por defecto.
  const detalle = crearCargarReservaDetalleFake(
    opciones.reservaDetalle === undefined ? reservaHidratada() : opciones.reservaDetalle,
  );
  const deps: FinalizarEventoDeps = {
    unidadDeTrabajo: uow,
    cargarReserva: jest.fn(async () => reserva),
    cargarReservaDetalle: (comando: FinalizarEventoComando) => detalle.cargar(comando),
    dispararE5: e5,
    documentacion,
  };
  return { deps, repos, uow, e5, documentacion, detalle };
};

const comando = (
  over: Partial<FinalizarEventoComando> = {},
): FinalizarEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.3 — Happy path con fianza: transiciona a post_evento + AUDIT_LOG (origen Usuario).
//        fix-liquidacion-fianza-independientes: la finalización YA NO dispara E5 (se elimina
//        la captura de IBAN E5/E8). e5.resultado=no_aplica siempre; el puerto NO se invoca.
//        NPS programada. La transición + auditoría son idénticas.
// ===========================================================================

describe('FinalizarEvento — happy path con fianza sin E5 (3.3)', () => {
  it('debe_transicionar_a_post_evento_sin_disparar_e5_y_auditar_como_usuario', async () => {
    const { deps, repos, e5 } = construir({
      reserva: reservaEnCurso({ fianzaEur: '1000.00', fianzaStatus: 'cobrada' }),
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // Estado resultante en la respuesta.
    expect(resultado.estado).toBe('post_evento');
    // E5 ya no se envía: no_aplica aun con fianza > 0.
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();
    expect(resultado.documentacionPendiente).toEqual([]);

    // Transición aplicada exactamente una vez.
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledTimes(1);

    // AUDIT_LOG de la transición: accion='transicion', entidad='RESERVA', origen Usuario
    // (usuarioId poblado), datos_anteriores/datos_nuevos correctos.
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: RESERVA_ID,
        datosAnteriores: { estado: 'evento_en_curso' },
        datosNuevos: { estado: 'post_evento' },
      }),
    );

    // El puerto de E5 NUNCA se invoca (flujo E5 eliminado).
    expect(e5.disparar).not.toHaveBeenCalled();
  });

  it('debe_hidratar_la_reserva_completa_releida_post_commit_para_el_allof_reserva', async () => {
    const { deps, detalle } = construir();
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La RESERVA se re-lee tras el commit (misma proyección que GET /reservas/{id}) y viaja en
    // `reserva` para hidratar el `allOf(Reserva)` del contrato FinalizarEventoResponse.
    expect(detalle.cargar).toHaveBeenCalledTimes(1);
    expect(detalle.cargar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, reservaId: RESERVA_ID }),
    );
    expect(resultado.reserva).not.toBeNull();
    expect(resultado.reserva?.idReserva).toBe(RESERVA_ID);
    expect(resultado.reserva?.codigo).toBe('SLO-2026-0034');
    expect(resultado.reserva?.clienteId).toBe(CLIENTE_ID);
    expect(resultado.reserva?.estado).toBe('post_evento');
    expect(resultado.reserva?.fianzaEur).toBe('1000.00');
  });

  it('debe_caer_a_reserva_null_sin_tumbar_la_finalizacion_si_la_relectura_falla', async () => {
    const { deps, detalle } = construir();
    // La relectura post-commit lanza (best-effort D-2): la transición ya commiteó; el fallo
    // de la relectura no debe tumbar la respuesta.
    detalle.cargar.mockRejectedValueOnce(new Error('BD_NO_DISPONIBLE'));
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('post_evento');
    expect(resultado.reserva).toBeNull();
    expect(resultado.e5.resultado).toBe('no_aplica');
  });

  it('debe_marcar_la_nps_como_programada_en_el_paso_transaccional', async () => {
    const { deps, repos } = construir();
    const uc = new FinalizarEventoUseCase(deps);

    await uc.ejecutar(comando());

    // La marca de NPS programada viaja en la mutación transaccional de la RESERVA
    // (marca derivada, design.md §D-6): la transición la fija junto al estado.
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ npsProgramada: true }),
    );
  });
});

// ===========================================================================
// 3.4 — Sin fianza (fianza_eur=0 y fianza_eur=NULL): transiciona a post_evento; NO se
//        dispara E5 (resultado=no_aplica, comunicacionId=null); NPS programada igualmente.
// ===========================================================================

describe('FinalizarEvento — sin fianza no dispara E5 (3.4)', () => {
  it('no_debe_disparar_e5_cuando_fianza_eur_es_cero', async () => {
    const { deps, repos, e5 } = construir({
      reserva: reservaEnCurso({ fianzaEur: '0.00', fianzaStatus: 'pendiente' }),
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('post_evento');
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();
    // Transición SÍ; E5 NO.
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledTimes(1);
    expect(e5.disparar).not.toHaveBeenCalled();
    // NPS programada igualmente (independiente de la fianza).
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ npsProgramada: true }),
    );
  });

  it('no_debe_disparar_e5_cuando_fianza_eur_es_null', async () => {
    const { deps, e5 } = construir({
      reserva: reservaEnCurso({ fianzaEur: null, fianzaStatus: 'pendiente' }),
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('post_evento');
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();
    expect(e5.disparar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.5 — Dato anómalo: fianza_status='cobrada' pero fianza_eur IS NULL → se trata como
//        sin fianza (NO E5) y se registra una ALERTA DE DATO ANÓMALO en AUDIT_LOG.
// ===========================================================================

describe('FinalizarEvento — dato anómalo fianza cobrada sin importe (3.5)', () => {
  it('debe_tratar_como_sin_fianza_y_registrar_alerta_de_dato_anomalo', async () => {
    const { deps, repos, e5 } = construir({
      reserva: reservaEnCurso({ fianzaEur: null, fianzaStatus: 'cobrada' }),
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // Se trata como sin fianza: transiciona pero NO dispara E5.
    expect(resultado.estado).toBe('post_evento');
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(e5.disparar).not.toHaveBeenCalled();

    // Además de la auditoría de transición, se registra una entrada de ALERTA de dato
    // anómalo (accion='actualizar') referida a la fianza inconsistente.
    const llamadas = repos.auditoria.registrar.mock.calls.map((c) => c[0]);
    const alerta = llamadas.find(
      (r: { datosNuevos?: Record<string, unknown> }) =>
        r.datosNuevos?.motivo === 'dato_anomalo_fianza',
    );
    expect(alerta).toBeDefined();
    expect(alerta).toEqual(
      expect.objectContaining({
        tenantId: TENANT,
        entidad: 'RESERVA',
        entidadId: RESERVA_ID,
      }),
    );
  });
});

// ===========================================================================
// 3.6 — fix-liquidacion-fianza-independientes: el flujo de E5 (solicitud de IBAN) se ha
//        eliminado. La finalización NO dispara ningún email: no existe un E5 que pueda
//        fallar. Se conserva un único caso que fija que la finalización procede sin envío
//        alguno (puerto de E5 nunca invocado, e5.resultado=no_aplica).
// ===========================================================================

describe('FinalizarEvento — la finalización no dispara ningún email (3.6)', () => {
  it('debe_finalizar_sin_disparar_e5_y_devolver_no_aplica', async () => {
    const { deps, repos, e5 } = construir({
      reserva: reservaEnCurso({ fianzaEur: '1000.00', fianzaStatus: 'cobrada' }),
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La transición se commiteó; post_evento se mantiene.
    expect(resultado.estado).toBe('post_evento');
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledTimes(1);
    // Sin envío de E5: no_aplica y puerto no invocado.
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();
    expect(e5.disparar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — Conflicto de estado: RESERVA en estado != evento_en_curso → TransicionNoPermitida
//        (409, code=transicion_no_permitida), SIN mutar la RESERVA, SIN E5, SIN AUDIT_LOG
//        de transición. Cubre `reserva_confirmada` (previo) y `post_evento` (segunda
//        finalización / irreversibilidad).
// ===========================================================================

describe('FinalizarEvento — conflicto de estado / irreversibilidad (3.7)', () => {
  const estadosInvalidos = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ] as const;

  it.each(estadosInvalidos)(
    'debe_rechazar_con_transicion_no_permitida_desde_%s_sin_efectos',
    async (estado) => {
      const { deps, repos, e5 } = construir({
        reserva: reservaEnCurso({ estado }),
      });
      const uc = new FinalizarEventoUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
        TransicionNoPermitidaError,
      );

      // Sin transición, sin E5, sin auditoría de transición (rechazo previo a la tx).
      expect(repos.reservas.finalizarEvento).not.toHaveBeenCalled();
      expect(e5.disparar).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_code_transicion_no_permitida_en_el_error', async () => {
    const { deps } = construir({ reserva: reservaEnCurso({ estado: 'post_evento' }) });
    const uc = new FinalizarEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });
  });
});

// ===========================================================================
// RESERVA inexistente / de otro tenant (RLS): cargarReserva devuelve null → 404.
// ===========================================================================

describe('FinalizarEvento — reserva inexistente o de otro tenant (404)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos, e5 } = construir({ reserva: null });
    const uc = new FinalizarEventoUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(repos.reservas.finalizarEvento).not.toHaveBeenCalled();
    expect(e5.disparar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.8 — Advertencia NO bloqueante de checklist (US-033): con ítems pendientes, la
//        respuesta los enumera pero la transición SE EJECUTA; sin ítems → []; fail-open
//        si el puerto de documentación no está disponible → [] y no bloquea.
// ===========================================================================

describe('FinalizarEvento — advertencia no bloqueante de documentación (3.8)', () => {
  it('debe_incluir_los_items_pendientes_sin_bloquear_la_transicion', async () => {
    const { deps, repos } = construir({
      itemsPendientes: ['dni_anverso', 'clausula_responsabilidad'],
    });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La transición procede igualmente (advertencia informativa).
    expect(resultado.estado).toBe('post_evento');
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledTimes(1);
    // La lista de pendientes se devuelve para la advertencia.
    expect(resultado.documentacionPendiente).toEqual([
      'dni_anverso',
      'clausula_responsabilidad',
    ]);
  });

  it('debe_devolver_lista_vacia_cuando_la_documentacion_esta_completa', async () => {
    const { deps } = construir({ itemsPendientes: [] });
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.documentacionPendiente).toEqual([]);
  });

  it('debe_fail_open_devolviendo_lista_vacia_si_el_puerto_de_documentacion_lanza', async () => {
    const { deps, repos } = construir();
    // El puerto de documentación no está disponible (US-033 aún no expuesta): fail-open.
    (deps.documentacion.itemsPendientes as jest.Mock).mockRejectedValueOnce(
      new Error('DOCUMENTACION_NO_DISPONIBLE'),
    );
    const uc = new FinalizarEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La finalización procede y la advertencia queda vacía (no bloquea).
    expect(resultado.estado).toBe('post_evento');
    expect(resultado.documentacionPendiente).toEqual([]);
    expect(repos.reservas.finalizarEvento).toHaveBeenCalledTimes(1);
  });
});
