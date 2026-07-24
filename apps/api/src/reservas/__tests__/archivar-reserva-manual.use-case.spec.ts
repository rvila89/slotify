/**
 * TESTS del caso de uso `ArchivarReservaManualUseCase` (US-038 / UC-28 flujo alternativo
 * MANUAL, actor Gestor) — fase TDD RED. tasks.md Fase 4: 4.2 (happy path fianza resuelta),
 * 4.3 (sin filtro T+7d), 4.4 (FA-01/FA-02 fianza no resuelta bloquea), 4.5 (origen inválido /
 * idempotencia), 4.6 (RESERVA inexistente / otro tenant).
 *
 * Trazabilidad: US-038; spec-delta `consultas` (Requirements: "Archivado manual de la reserva
 * a reserva_completada por el gestor desde la ficha", "La condición de fianza resuelta del
 * archivado manual es idéntica a la del automático (US-037)", "Bloqueo del archivado manual
 * con fianza no resuelta y mensaje específico", "La auditoría del archivado manual registra
 * el origen Gestor con usuario_id", "Idempotencia y concurrencia del archivado manual frente
 * al cron de US-037"); design.md §D-1=1.A (compartir SOLO las guardas puras + UoW manual
 * delgada), §D-3=3.B (fianza no resuelta → 422 `FianzaNoResueltaError`; origen inválido → 409
 * `TransicionNoPermitidaError`), §D-5 (auditoría origen Gestor con `usuario_id`), §D-7.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal, hook `no-infra-in-domain`): se
 * ejercita el caso de uso contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la
 * BD. La ATOMICIDAD REAL (`$transaction` + `fijarTenant` + `SELECT … FOR UPDATE` +
 * re-evaluación de `resolverArchivadoAutomatico` y `fianzaResuelta` bajo el lock) vive en el
 * adaptador y en `…-integracion/…-concurrencia.spec.ts`. Aquí se fija la ORQUESTACIÓN
 * (gemelo MANUAL de `finalizar-evento.use-case.spec.ts` de US-034):
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Guarda de ORIGEN (`resolverArchivadoAutomatico`): si `estado ≠ post_evento` →
 *      `TransicionNoPermitidaError` (409), SIN tx, SIN auditar.
 *   2. Guarda de FIANZA (`fianzaResuelta`): si NO resuelta (eur>0 y status pendiente) →
 *      `FianzaNoResueltaError` (422 D-3=3.B) con el mensaje FA-01, SIN tx, SIN auditar.
 *   3. Paso TRANSACCIONAL vía la UoW: `UPDATE … WHERE estado='post_evento'` bajo el lock
 *      (devuelve `filasAfectadas`; `0` ⇒ carrera perdida → `TransicionNoPermitidaError`) +
 *      AUDIT_LOG `accion='transicion'` origen Gestor (`usuario_id` del JWT). SIN filtro T+7d.
 *
 * RED: aún NO existe `reservas/application/archivar-reserva-manual.use-case.ts` ni sus
 * puertos/tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ArchivarReservaManualUseCase,
  ReservaNoEncontradaError,
  TransicionNoPermitidaError,
  FianzaNoResueltaError,
  MENSAJE_FIANZA_NO_RESUELTA,
  type ArchivarReservaManualDeps,
  type ArchivarReservaManualComando,
  type ReservaArchivable,
  type RepositoriosArchivadoManual,
  type UnidadDeTrabajoArchivadoManualPort,
} from '../application/archivar-reserva-manual.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-archivar';

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en post_evento con matriz de fianza.
// ---------------------------------------------------------------------------

const reservaPostEvento = (
  over: Partial<ReservaArchivable> = {},
): ReservaArchivable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'post_evento',
  subEstado: null,
  fianzaEur: '300.00',
  fianzaStatus: 'devuelta',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW fake. El use-case orquesta la tx de transición.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosArchivadoManual {
  reservas: { archivar: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  reservas: {
    // El adaptador real hace `UPDATE … WHERE estado='post_evento'` bajo el lock y devuelve
    // las filas afectadas (`0` ⇒ la guarda ya no se cumple bajo el lock: carrera perdida).
    archivar: jest.fn(async () => ({ filasAfectadas: 1 })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

/**
 * UoW fake: ejecuta el trabajo con los repos fake bajo el contexto RLS del tenant. Si
 * `filasAfectadas` del repo es 0, el use-case debe abortar como conflicto (doble archivado /
 * estado ya cambiado bajo el lock); esa vertiente se prueba en `…-concurrencia.spec.ts`.
 */
const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoArchivadoManualPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosArchivadoManual) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

interface Escenario {
  deps: ArchivarReservaManualDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
}

const construir = (
  opciones: { reserva?: ReservaArchivable | null } = {},
): Escenario => {
  const repos = crearReposFake();
  const uow = crearUoWFake(repos);
  const reserva =
    opciones.reserva === undefined ? reservaPostEvento() : opciones.reserva;
  const deps: ArchivarReservaManualDeps = {
    unidadDeTrabajo: uow,
    cargarReserva: jest.fn(async () => reserva),
  };
  return { deps, repos, uow };
};

const comando = (
  over: Partial<ArchivarReservaManualComando> = {},
): ArchivarReservaManualComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 4.2 — Happy path (fianza resuelta): transiciona a reserva_completada + AUDIT_LOG origen
//        Gestor (usuario_id del JWT), datos_anteriores/datos_nuevos correctos.
//        spec-delta: "El gestor archiva una reserva en post_evento con la fianza resuelta" +
//        "El archivado manual se audita como acción del gestor".
// ===========================================================================

describe('ArchivarReservaManual — happy path fianza resuelta (4.2)', () => {
  it('debe_transicionar_a_reserva_completada_y_auditar_como_gestor', async () => {
    const { deps, repos } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'devuelta', fianzaEur: '300.00' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_completada');

    // Transición aplicada exactamente una vez bajo la UoW (una sola transacción).
    expect(repos.reservas.archivar).toHaveBeenCalledTimes(1);

    // AUDIT_LOG de la transición: origen GESTOR (usuario_id poblado, NO nulo como US-037),
    // accion='transicion', entidad='RESERVA', datos_anteriores/datos_nuevos correctos.
    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: RESERVA_ID,
        datosAnteriores: { estado: 'post_evento' },
        datosNuevos: { estado: 'reserva_completada' },
      }),
    );
  });

  it('debe_archivar_sin_fianza_eur_0_aunque_el_status_sea_cobrada', async () => {
    const { deps, repos } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'cobrada', fianzaEur: '0.00' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_completada');
    expect(repos.reservas.archivar).toHaveBeenCalledTimes(1);
  });

  it('debe_archivar_sin_fianza_eur_null_aunque_el_status_sea_cobrada', async () => {
    const { deps } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'cobrada', fianzaEur: null }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_completada');
  });

  it('debe_archivar_retenida_parcial_retencion_100_como_fianza_resuelta', async () => {
    // retenida_parcial (con importe devuelto 0, retención 100%) es un estado resuelto:
    // la guarda de fianza NO mira el importe devuelto.
    const { deps } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'devuelta', fianzaEur: '500.00' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_completada');
  });
});

// ===========================================================================
// 4.3 — Sin filtro T+7d: el archivado MANUAL NO exige antigüedad. Una RESERVA post_evento
//        recién finalizada (p. ej. hoy) archiva igualmente (la única guarda de estado es
//        `estado = post_evento`). El use-case NO recibe ni consulta `fecha_post_evento`.
//        spec-delta: "no se aplica ningún filtro de antigüedad T+7d".
// ===========================================================================

describe('ArchivarReservaManual — sin filtro de antigüedad T+7d (4.3)', () => {
  it('debe_archivar_una_post_evento_reciente_sin_evaluar_dias_transcurridos', async () => {
    // La proyección `ReservaArchivable` no incluye fecha_post_evento: el manual no la lee.
    const { deps, repos } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'devuelta', fianzaEur: '300.00' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_completada');
    expect(repos.reservas.archivar).toHaveBeenCalledTimes(1);
    // El comando no transporta ninguna referencia de antigüedad: solo tenant/usuario/reserva.
    const params = repos.reservas.archivar.mock.calls[0]?.[0] ?? {};
    expect(params).not.toHaveProperty('fechaPostEvento');
    expect(params).not.toHaveProperty('diasEnPostEvento');
  });
});

// ===========================================================================
// 4.4 — FA-01/FA-02: fianza NO resuelta (status ∈ {cobrada, recibo_enviado, pendiente} con
//        eur>0) → NO transiciona (permanece post_evento), 0 auditorías, FianzaNoResueltaError
//        (→ 422 D-3=3.B) con el mensaje específico. SIN abrir la transacción.
//        spec-delta: "Fianza cobrada sin resolver (FA-01) — bloquea" + "recibo_enviado (FA-02)".
// ===========================================================================

describe('ArchivarReservaManual — fianza no resuelta bloquea (FA-01/FA-02) (4.4)', () => {
  const noResueltas = ['cobrada', 'cobrada', 'pendiente'] as const;

  it.each(noResueltas)(
    'debe_bloquear_con_FianzaNoResueltaError_cuando_status_%s_y_eur_positivo',
    async (fianzaStatus) => {
      const { deps, repos } = construir({
        reserva: reservaPostEvento({ fianzaStatus, fianzaEur: '300.00' }),
      });
      const uc = new ArchivarReservaManualUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(FianzaNoResueltaError);

      // NO transiciona ni audita: rechazo previo a la tx.
      expect(repos.reservas.archivar).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_el_code_fianza_no_resuelta_y_el_mensaje_especifico_de_FA_01', async () => {
    const { deps } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'cobrada', fianzaEur: '300.00' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'fianza_no_resuelta',
      message: MENSAJE_FIANZA_NO_RESUELTA,
    });

    // El mensaje literal de FA-01/FA-02 (defensa: fijar el contrato del texto).
    expect(MENSAJE_FIANZA_NO_RESUELTA).toBe(
      'No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar.',
    );
  });
});

// ===========================================================================
// 4.5 — Origen inválido / idempotencia: RESERVA en estado ≠ post_evento (incl. ya
//        reserva_completada por un pase del cron US-037) → guarda de origen null →
//        TransicionNoPermitidaError (409 `transicion_no_permitida`), SIN mutar ni auditar.
//        spec-delta: "Intento de archivar una reserva que no está en post_evento".
// ===========================================================================

describe('ArchivarReservaManual — origen inválido / idempotencia (4.5)', () => {
  const estadosInvalidos = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'reserva_completada',
    'reserva_cancelada',
  ] as const;

  it.each(estadosInvalidos)(
    'debe_rechazar_con_transicion_no_permitida_desde_%s_sin_efectos',
    async (estado) => {
      const { deps, repos } = construir({ reserva: reservaPostEvento({ estado }) });
      const uc = new ArchivarReservaManualUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
        TransicionNoPermitidaError,
      );

      expect(repos.reservas.archivar).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_code_transicion_no_permitida_desde_reserva_completada', async () => {
    const { deps } = construir({
      reserva: reservaPostEvento({ estado: 'reserva_completada' }),
    });
    const uc = new ArchivarReservaManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });
  });

  it('debe_abortar_como_conflicto_cuando_la_UPDATE_afecta_0_filas_carrera_perdida', async () => {
    // Bajo el lock, la 2.ª de dos operaciones concurrentes ve el estado ya cambiado: la
    // UPDATE condicional afecta 0 filas → conflicto (transicion_no_permitida), sin auditar.
    const { deps, repos } = construir({
      reserva: reservaPostEvento({ fianzaStatus: 'devuelta', fianzaEur: '300.00' }),
    });
    repos.reservas.archivar.mockResolvedValueOnce({ filasAfectadas: 0 });
    const uc = new ArchivarReservaManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4.6 — RESERVA inexistente / de otro tenant (RLS): cargarReserva devuelve null → 404
//        (ReservaNoEncontradaError), sin mutar ni auditar.
//        spec-delta: "Reserva inexistente o de otro tenant".
// ===========================================================================

describe('ArchivarReservaManual — reserva inexistente o de otro tenant (404) (4.6)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos } = construir({ reserva: null });
    const uc = new ArchivarReservaManualUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(repos.reservas.archivar).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});
