/**
 * TESTS del caso de uso `ForzarInicioEventoUseCase` (US-032 / UC-23 FA-01, actor Gestor)
 * — fase TDD RED. tasks.md Fase 3: 3.3, 3.4, 3.5 (parcial), 3.6, 3.7.
 *
 * Trazabilidad: US-032, spec-delta `consultas` (Requirements "Forzado manual del inicio
 * de evento por el Gestor", "El forzado solo está disponible el día del evento", "La
 * lista de precondiciones incumplidas se calcula bajo el lock y se persiste en la
 * auditoría", "La transición forzada se registra en AUDIT_LOG con origen Usuario y
 * forzado_por_gestor = true", "El forzado no resuelve ni modifica los sub-procesos
 * incumplidos", "Cron llegó primero — idempotencia"), design.md §D-1/§D-3/§D-4/§D-7.
 * Contrato `docs/api-spec.yml` op `forzarInicioEvento`:
 *   - 200: `allOf(Reserva)` (RESERVA en `evento_en_curso`) + `forzadoPorGestor: true` +
 *     `precondicionesIncumplidas: string[]`.
 *   - 409 `code: conflicto_estado` cuando `estado != reserva_confirmada`.
 *   - 422 `code: fecha_evento_no_es_hoy` cuando `estado = reserva_confirmada` pero
 *     `date(fecha_evento) != date(hoy)`.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD/concurrencia y el
 * `SELECT … FOR UPDATE` REALES viven en `…-integracion.spec.ts` y
 * `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN, ESPEJO de
 * `FinalizarEventoUseCase` (US-034):
 *   0. Cargar RESERVA bajo RLS del tenant del JWT → `null` → 404.
 *   1. Guarda de ORIGEN `resolverInicioEvento` (estado != reserva_confirmada) → 409 SIN
 *      efectos (sin tx, sin AUDIT_LOG).
 *   2. Guarda de FECHA `esDiaDelEvento(fechaEvento, hoy)` (fecha != hoy) → 422 SIN efectos.
 *   3. Transacción (`UnidadDeTrabajoForzarInicioPort`): UPDATE condicional `WHERE
 *      estado='reserva_confirmada'`; 0 filas → 409. Calcula `faltantes` con
 *      `preconditionesEventoCumplidas` bajo el lock y audita origen Usuario con
 *      `forzado_por_gestor: true` + `precondiciones_incumplidas: faltantes`. FUERZA la
 *      transición aunque `cumple === false` (a diferencia de US-031).
 *   4. Re-lee la RESERVA post-commit y devuelve
 *      `{ reserva, forzadoPorGestor: true, precondicionesIncumplidas }`.
 *
 * RED: aún NO existe `reservas/application/forzar-inicio-evento.use-case.ts` ni sus
 * puertos/tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ForzarInicioEventoUseCase,
  ReservaNoEncontradaError,
  ConflictoEstadoError,
  FechaEventoNoEsHoyError,
  type ForzarInicioEventoDeps,
  type ForzarInicioEventoComando,
  type ReservaForzarInicio,
  type ReservaHidratadaForzarInicio,
  type RepositoriosForzarInicio,
  type UnidadDeTrabajoForzarInicioPort,
} from '../application/forzar-inicio-evento.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-forzar';
const CLIENTE_ID = 'cli-1';

/** Fecha de calendario de "hoy" a mediodía local (guarda de fecha determinista). */
const hoyMediodia = (): Date => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
};

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en reserva_confirmada + fecha_evento hoy + matriz *_status.
// ---------------------------------------------------------------------------

const reservaConfirmada = (
  over: Partial<ReservaForzarInicio> = {},
): ReservaForzarInicio => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'reserva_confirmada',
  subEstado: null,
  fechaEvento: hoyMediodia(),
  // Por defecto UNA precondición incumplida (caso canónico del forzado).
  preEventoStatus: 'cerrado',
  liquidacionStatus: 'facturada',
  fianzaStatus: 'cobrada',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW fake. El use-case orquesta la tx de la transición.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosForzarInicio {
  reservas: { forzarInicioEvento: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

/** Por defecto la UPDATE condicional afecta 1 fila (el forzado gana). */
const crearReposFake = (filasAfectadas = 1): ReposFake => ({
  reservas: {
    forzarInicioEvento: jest.fn(async () => ({ filasAfectadas })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

/** UoW fake: ejecuta el trabajo con los repos fake (misma forma que US-034). */
const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoForzarInicioPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosForzarInicio) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

/** RESERVA COMPLETA re-leída POST-COMMIT (ya en evento_en_curso) para el allOf(Reserva). */
const reservaHidratada = (
  over: Partial<ReservaHidratadaForzarInicio> = {},
): ReservaHidratadaForzarInicio => ({
  idReserva: RESERVA_ID,
  codigo: 'SLO-2026-0032',
  clienteId: CLIENTE_ID,
  estado: 'evento_en_curso',
  subEstado: null,
  canalEntrada: 'email',
  fechaEvento: hoyMediodia(),
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
  liquidacionStatus: 'facturada',
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
    email: 'ada@us032.test',
    telefono: null,
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
  },
  ...over,
});

interface Escenario {
  deps: ForzarInicioEventoDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
  detalle: jest.Mock;
}

const construir = (
  opciones: {
    reserva?: ReservaForzarInicio | null;
    reservaDetalle?: ReservaHidratadaForzarInicio | null;
    filasAfectadas?: number;
  } = {},
): Escenario => {
  const repos = crearReposFake(opciones.filasAfectadas ?? 1);
  const uow = crearUoWFake(repos);
  const reserva =
    opciones.reserva === undefined ? reservaConfirmada() : opciones.reserva;
  const detalle = jest.fn(
    async (
      _comando: ForzarInicioEventoComando,
    ): Promise<ReservaHidratadaForzarInicio | null> =>
      opciones.reservaDetalle === undefined
        ? reservaHidratada()
        : opciones.reservaDetalle,
  );
  const deps: ForzarInicioEventoDeps = {
    unidadDeTrabajo: uow,
    cargarReserva: jest.fn(async () => reserva),
    cargarReservaDetalle: (comando: ForzarInicioEventoComando) => detalle(comando),
  };
  return { deps, repos, uow, detalle };
};

const comando = (
  over: Partial<ForzarInicioEventoComando> = {},
): ForzarInicioEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.3 — Happy path: reserva_confirmada + fecha hoy + UNA precondición incumplida →
//        transiciona a evento_en_curso; devuelve forzadoPorGestor=true +
//        precondicionesIncumplidas=[faltantes]; AUDIT_LOG origen Usuario con
//        datos_nuevos={estado, forzado_por_gestor:true, precondiciones_incumplidas:[...]}.
// ===========================================================================

describe('ForzarInicioEvento — happy path forzado con una precondición incumplida (3.3)', () => {
  it('debe_transicionar_a_evento_en_curso_forzado_y_auditar_como_usuario', async () => {
    const { deps, repos } = construir({
      reserva: reservaConfirmada({ liquidacionStatus: 'facturada' }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // Estado y bandera de override en la respuesta.
    expect(resultado.estado).toBe('evento_en_curso');
    expect(resultado.forzadoPorGestor).toBe(true);
    expect(resultado.precondicionesIncumplidas).toEqual(['liquidacion_status']);

    // Transición aplicada exactamente una vez, con guarda de origen en la UPDATE condicional.
    expect(repos.reservas.forzarInicioEvento).toHaveBeenCalledTimes(1);
    expect(repos.reservas.forzarInicioEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        tenantId: TENANT,
        estadoOrigen: 'reserva_confirmada',
        estadoDestino: 'evento_en_curso',
      }),
    );

    // AUDIT_LOG de la transición: accion='transicion', entidad='RESERVA', origen Usuario
    // (usuario_id poblado), datos_anteriores/datos_nuevos con la evidencia del override.
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: RESERVA_ID,
        datosAnteriores: { estado: 'reserva_confirmada' },
        datosNuevos: {
          estado: 'evento_en_curso',
          forzado_por_gestor: true,
          precondiciones_incumplidas: ['liquidacion_status'],
        },
      }),
    );
  });

  it('debe_hidratar_la_reserva_completa_releida_post_commit_para_el_allof_reserva', async () => {
    const { deps, detalle } = construir();
    const uc = new ForzarInicioEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(detalle).toHaveBeenCalledTimes(1);
    expect(detalle).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, reservaId: RESERVA_ID }),
    );
    expect(resultado.reserva).not.toBeNull();
    expect(resultado.reserva?.idReserva).toBe(RESERVA_ID);
    expect(resultado.reserva?.estado).toBe('evento_en_curso');
    expect(resultado.reserva?.codigo).toBe('SLO-2026-0032');
  });

  it('debe_derivar_tenant_y_usuario_del_comando_nunca_del_body', async () => {
    const { deps } = construir();
    const uc = new ForzarInicioEventoUseCase(deps);

    await uc.ejecutar(comando());

    expect(deps.cargarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, usuarioId: GESTOR, reservaId: RESERVA_ID }),
    );
  });
});

// ===========================================================================
// 3.4 — Múltiples precondiciones incumplidas: las tres incumplidas → transiciona
//        igualmente y `precondiciones_incumplidas` lista las tres. Caso BORDE: las tres
//        cumplidas al forzar → transiciona, precondicionesIncumplidas=[] pero
//        forzado_por_gestor sigue true.
// ===========================================================================

describe('ForzarInicioEvento — número variable de precondiciones incumplidas (3.4)', () => {
  it('debe_transicionar_y_listar_las_precondiciones_incumplidas', async () => {
    // fix-liquidacion-fianza-independientes (§D-4): la fianza deja de ser precondición del
    // inicio del evento. Solo quedan pre_evento_status y liquidacion_status.
    const { deps, repos } = construir({
      reserva: reservaConfirmada({
        preEventoStatus: 'pendiente',
        liquidacionStatus: 'facturada',
        fianzaStatus: 'pendiente',
      }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('evento_en_curso');
    expect(resultado.forzadoPorGestor).toBe(true);
    expect(resultado.precondicionesIncumplidas).toEqual([
      'pre_evento_status',
      'liquidacion_status',
    ]);
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        datosNuevos: expect.objectContaining({
          forzado_por_gestor: true,
          precondiciones_incumplidas: ['pre_evento_status', 'liquidacion_status'],
        }),
      }),
    );
  });

  it('caso_borde_las_tres_cumplidas_transiciona_con_lista_vacia_pero_forzado_true', async () => {
    const { deps, repos } = construir({
      reserva: reservaConfirmada({
        preEventoStatus: 'cerrado',
        liquidacionStatus: 'cobrada',
        fianzaStatus: 'cobrada',
      }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La transición se EJECUTA igualmente (a diferencia de US-031, el forzado no veta).
    expect(resultado.estado).toBe('evento_en_curso');
    expect(resultado.precondicionesIncumplidas).toEqual([]);
    // forzado_por_gestor sigue true: distingue el override de un inicio automático (US-031).
    expect(resultado.forzadoPorGestor).toBe(true);
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        datosNuevos: expect.objectContaining({
          forzado_por_gestor: true,
          precondiciones_incumplidas: [],
        }),
      }),
    );
  });
});

// ===========================================================================
// 3.5 (unit) — D-5: los *_status incumplidos NO se modifican (la mutación toca SOLO
//        `estado`). Se verifica que la UPDATE de la transición NO recibe ningún *_status
//        a mutar (la comprobación en BD real está en el test de integración).
// ===========================================================================

describe('ForzarInicioEvento — los sub-procesos incumplidos NO se resuelven (D-5, 3.5)', () => {
  it('la_mutacion_no_debe_incluir_cambios_a_pre_evento_liquidacion_o_fianza_status', async () => {
    const { deps, repos } = construir({
      reserva: reservaConfirmada({ liquidacionStatus: 'facturada' }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    await uc.ejecutar(comando());

    const params = repos.reservas.forzarInicioEvento.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // La mutación fija estadoDestino=evento_en_curso pero NO toca ningún *_status.
    expect(params.estadoDestino).toBe('evento_en_curso');
    expect(params).not.toHaveProperty('preEventoStatus');
    expect(params).not.toHaveProperty('liquidacionStatus');
    expect(params).not.toHaveProperty('fianzaStatus');
  });
});

// ===========================================================================
// 3.6 — Guarda de FECHA (422): reserva_confirmada pero fecha_evento != hoy →
//        FechaEventoNoEsHoyError (422 fecha_evento_no_es_hoy), SIN transición, SIN AUDIT.
//        Se rechaza ANTES de abrir la transacción.
// ===========================================================================

describe('ForzarInicioEvento — fecha del evento no es hoy (422, 3.6)', () => {
  const ayer = (): Date => {
    const d = hoyMediodia();
    d.setDate(d.getDate() - 1);
    return d;
  };
  const manana = (): Date => {
    const d = hoyMediodia();
    d.setDate(d.getDate() + 1);
    return d;
  };

  it('debe_rechazar_con_fecha_no_es_hoy_cuando_el_evento_es_manana_sin_efectos', async () => {
    const { deps, repos } = construir({
      reserva: reservaConfirmada({ fechaEvento: manana() }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(FechaEventoNoEsHoyError);

    // Sin transición, sin auditoría (rechazo previo a la tx).
    expect(repos.reservas.forzarInicioEvento).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_fecha_no_es_hoy_cuando_el_evento_fue_ayer', async () => {
    const { deps } = construir({ reserva: reservaConfirmada({ fechaEvento: ayer() }) });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'fecha_evento_no_es_hoy',
    });
  });
});

// ===========================================================================
// 3.7 — Conflicto de estado (409): estado != reserva_confirmada (evento_en_curso incl.
//        "cron llegó primero", pre_reserva, post_evento, …) → ConflictoEstadoError (409
//        conflicto_estado), SIN transición, SIN AUDIT. Idempotencia: segundo forzado 409.
// ===========================================================================

describe('ForzarInicioEvento — conflicto de estado / idempotencia (409, 3.7)', () => {
  const estadosInvalidos = [
    'consulta',
    'pre_reserva',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ] as const;

  it.each(estadosInvalidos)(
    'debe_rechazar_con_conflicto_estado_desde_%s_sin_efectos',
    async (estado) => {
      const { deps, repos } = construir({
        reserva: reservaConfirmada({ estado }),
      });
      const uc = new ForzarInicioEventoUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(ConflictoEstadoError);

      expect(repos.reservas.forzarInicioEvento).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_code_conflicto_estado_cuando_el_cron_llego_primero', async () => {
    const { deps } = construir({ reserva: reservaConfirmada({ estado: 'evento_en_curso' }) });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'conflicto_estado',
    });
  });

  it('debe_traducir_0_filas_bajo_el_lock_a_conflicto_estado_sin_auditar', async () => {
    // La guarda previa pasa (reserva_confirmada + hoy) pero bajo el lock otra operación
    // ganó: la UPDATE condicional afecta 0 filas → conflicto, sin auditoría de transición.
    const { deps, repos } = construir({ filasAfectadas: 0 });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(ConflictoEstadoError);

    // Se intentó la UPDATE (una vez) pero NO se auditó (0 filas → no-op idempotente).
    expect(repos.reservas.forzarInicioEvento).toHaveBeenCalledTimes(1);
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS): cargarReserva devuelve null → 404.
//        Se evalúa ANTES que la guarda de origen y la de fecha (orden 404 → 409 → 422).
// ===========================================================================

describe('ForzarInicioEvento — reserva inexistente o de otro tenant (404)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos } = construir({ reserva: null });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(repos.reservas.forzarInicioEvento).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Orden de evaluación (D-1): 404 → 409 (origen) → 422 (fecha) → 409 (0 filas bajo lock).
//        Una RESERVA en estado inválido Y con fecha != hoy debe fallar por CONFLICTO
//        (409, la guarda de origen se evalúa antes que la de fecha), no por 422.
// ===========================================================================

describe('ForzarInicioEvento — orden de evaluación de las guardas (D-1)', () => {
  it('debe_priorizar_409_de_origen_sobre_422_de_fecha_cuando_ambas_fallan', async () => {
    const manana = (): Date => {
      const d = hoyMediodia();
      d.setDate(d.getDate() + 1);
      return d;
    };
    const { deps } = construir({
      // estado != reserva_confirmada Y fecha != hoy: gana el 409 (origen antes que fecha).
      reserva: reservaConfirmada({ estado: 'evento_en_curso', fechaEvento: manana() }),
    });
    const uc = new ForzarInicioEventoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(ConflictoEstadoError);
  });
});
