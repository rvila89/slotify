/**
 * TESTS del caso de uso `ProgramarVisitaUseCase` (US-008 / UC-07) — fase TDD RED.
 * tasks.md Fase 3: 3.1 (guarda de origen nivel aplicación), 3.2 (2.a sin
 * fecha_evento), 3.3 (ventana de fecha + setting), 3.4 (UPDATE desde 2b/2c), 3.5
 * (INSERT desde 2a), 3.6 (atomicidad/rollback), 3.8 (E6 post-commit).
 *
 * Trazabilidad: US-008, spec-delta `consultas` (Requirements "Transición {2a,2b,2c}→2.v",
 * "El bloqueo de fecha se crea o actualiza … (fase 2.v)", "La fecha de visita debe ser
 * futura y dentro de la ventana max_dias_programar_visita", "Guarda de origen — solo
 * desde 2.a/2.b/2.c", "Programar visita desde 2.a exige fecha_evento", "Atomicidad de
 * la transición a 2.v"), spec-delta `comunicaciones` (Requirements "La transición a
 * 2.v dispara E6", "El envío de E6 es posterior al commit"); design.md §D-1..§D-6.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES viven
 * en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN:
 * guarda de origen multi-estado, precondición de fecha_evento (2a), ventana de fecha
 * derivada del setting, mutación de RESERVA (2v + campos de visita), upsert de
 * FECHA_BLOQUEADA (insert desde 2a / update desde 2b/2c) con TTL = visita +1 día
 * 23:59:59, AUDIT_LOG `transicion`, y el disparo de E6 POST-COMMIT (un fallo del
 * proveedor de email NO revierte la transición, D-6).
 *
 * Contrato del endpoint congelado (POST /reservas/{id}/visita; body `{fecha,hora}`):
 *   - 200 → RESERVA (2.v, visitaProgramada*, visitaRealizada=false, ttl nuevo).
 *   - 409 → `VisitaEnColaError` (RESERVA en 2.d: promover primero, UC-12).
 *   - 422 → `ProgramarVisitaValidacionError` (origen no en 2a/2b/2c, 2a sin
 *     fecha_evento, fecha fuera de la ventana [hoy+1, hoy+max_dias_programar_visita]).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 *
 * RED: aún NO existe `application/programar-visita.use-case.ts`. El import falla en
 * compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  ProgramarVisitaUseCase,
  ProgramarVisitaValidacionError,
  VisitaEnColaError,
  ReservaNoEncontradaError,
  type ProgramarVisitaComando,
  type ProgramarVisitaDeps,
  type RepositoriosProgramarVisita,
  type UnidadDeTrabajoProgramarVisitaPort,
  type ReservaProgramarVisita,
  type EnviarConfirmacionVisitaPort,
  type ClockPort,
} from '../application/programar-visita.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

// Reloj fijo determinista: la "ventana" se calcula desde este `ahora`.
const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
const MAX_DIAS = 7;

/** Fecha de visita por defecto: hoy + 3 días (dentro de la ventana [hoy+1, hoy+7]). */
const FECHA_VISITA = new Date('2026-07-03T00:00:00.000Z');
const HORA_VISITA = '17:30';

/** TTL esperado del bloqueo: fecha de visita + 1 día a las 23:59:59 (UTC). */
const ttlEsperadoVisita = (visita: Date): number =>
  Date.UTC(
    visita.getUTCFullYear(),
    visita.getUTCMonth(),
    visita.getUTCDate() + 1,
    23,
    59,
    59,
  );

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

/** RESERVA semilla en su estado de origen (por defecto `consulta`/`2b`). */
const reservaOrigen = (
  over: Partial<ReservaProgramarVisita> = {},
): ReservaProgramarVisita => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2b',
  ttlExpiracion: new Date(AHORA.getTime() + 5 * DIA_MS),
  fechaEvento: FECHA_EVENTO,
  visitaRealizada: false,
  ...over,
});

interface ReposFake extends RepositoriosProgramarVisita {
  reservas: {
    buscarPorId: jest.Mock;
    actualizar: jest.Mock;
  };
  fechaBloqueada: {
    leerBloqueoVigente: jest.Mock;
    upsertTtl: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaProgramarVisita | null;
  /** ¿Existe ya una fila FECHA_BLOQUEADA para la fecha? (origen 2b/2c = true). */
  conBloqueo?: boolean;
  /** Inyecta un fallo en una de las operaciones para probar rollback (3.6). */
  fallarEn?: 'actualizar' | 'upsertTtl' | 'auditoria';
}): ReposFake => {
  const reservas = {
    buscarPorId: jest.fn(async () =>
      'reserva' in opciones ? (opciones.reserva ?? null) : reservaOrigen(),
    ),
    actualizar: jest.fn(async (p: Record<string, unknown>) => {
      if (opciones.fallarEn === 'actualizar') {
        throw new Error('FALLO_SIMULADO_ACTUALIZAR');
      }
      return {
        ...reservaOrigen(),
        subEstado: p.subEstado,
        ttlExpiracion: (p.ttlExpiracion as Date | null) ?? null,
        visitaProgramadaFecha: p.visitaProgramadaFecha as Date,
        visitaProgramadaHora: p.visitaProgramadaHora as string,
        visitaRealizada: p.visitaRealizada as boolean,
      };
    }),
  };
  const fechaBloqueada = {
    // null ≡ no hay fila (origen 2a → INSERT); objeto ≡ fila existente (2b/2c → UPDATE).
    leerBloqueoVigente: jest.fn(async () =>
      opciones.conBloqueo === false ? null : { idBloqueo: 'blq-1', ttlExpiracion: null },
    ),
    upsertTtl: jest.fn(async () => {
      if (opciones.fallarEn === 'upsertTtl') {
        throw new Error('FALLO_SIMULADO_UPSERTTTL');
      }
      return undefined;
    }),
  };
  const auditoria = {
    registrar: jest.fn(async () => {
      if (opciones.fallarEn === 'auditoria') {
        throw new Error('FALLO_SIMULADO_AUDITORIA');
      }
      return undefined;
    }),
  };
  return { reservas, fechaBloqueada, auditoria };
};

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoProgramarVisitaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosProgramarVisita) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const relojFijo: ClockPort = { ahora: () => AHORA };

const montar = (
  opciones: Parameters<typeof crearReposFake>[0] = {},
  emailFalla = false,
) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const tenantSettings = {
    obtener: jest.fn(async () => ({
      ttlConsultaDias: 5,
      ttlPrereservaDias: 7,
      maxDiasProgramarVisita: MAX_DIAS,
    })),
  };
  // Puerto de E6 POST-COMMIT (modo fake): no envía red. Si `emailFalla`, simula
  // un fallo del proveedor para comprobar que NO revierte la transición (D-6).
  const confirmacionVisita: EnviarConfirmacionVisitaPort & { enviar: jest.Mock } = {
    enviar: jest.fn(async () => {
      if (emailFalla) {
        throw new Error('FALLO_PROVEEDOR_EMAIL_E6');
      }
      return { estado: 'enviado' as const, fechaEnvio: AHORA };
    }),
  };
  const deps: ProgramarVisitaDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
    tenantSettings,
    confirmacionVisita,
  };
  return {
    useCase: new ProgramarVisitaUseCase(deps),
    repos,
    uow,
    tenantSettings,
    confirmacionVisita,
  };
};

const comando = (
  over: Partial<ProgramarVisitaComando> = {},
): ProgramarVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  fechaVisita: FECHA_VISITA,
  horaVisita: HORA_VISITA,
  ...over,
});

// ===========================================================================
// 3.1 — Guarda de origen: solo 2a/2b/2c. 2d → 409 (UC-12); resto → 422 sin mutar.
// ===========================================================================

describe('ProgramarVisitaUseCase — guarda de origen {2a,2b,2c} (3.1)', () => {
  it('debe_rechazar_409_con_mensaje_UC_12_cuando_la_reserva_esta_en_cola_2d', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ subEstado: '2d' }),
    });

    const error = await useCase.ejecutar(comando()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VisitaEnColaError);
    expect((error as VisitaEnColaError).motivo).toMatch(/UC-12/);

    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.upsertTtl).not.toHaveBeenCalled();
  });

  it.each(['2v', '2x', '2y', '2z'] as const)(
    'debe_rechazar_422_y_sin_mutar_cuando_la_reserva_esta_en_%s',
    async (sub) => {
      const { useCase, repos } = montar({
        reserva: reservaOrigen({ subEstado: sub }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ProgramarVisitaValidacionError,
      );

      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.upsertTtl).not.toHaveBeenCalled();
    },
  );

  it('debe_rechazar_422_cuando_la_reserva_esta_en_un_estado_terminal_inmutable', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ estado: 'reserva_cancelada', subEstado: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ProgramarVisitaValidacionError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    // RLS / multi-tenancy: una RESERVA de otro tenant es invisible → 404.
    const { useCase, repos } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 — Programar desde 2.a exige fecha_evento definida → 422 si NULL, sin mutar.
// ===========================================================================

describe('ProgramarVisitaUseCase — 2.a exige fecha_evento (3.2)', () => {
  it('debe_rechazar_422_cuando_el_origen_es_2a_y_fecha_evento_es_null', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ subEstado: '2a', fechaEvento: null }),
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ProgramarVisitaValidacionError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.upsertTtl).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 — Ventana de la fecha de visita: [hoy+1, hoy+max_dias_programar_visita].
//        fecha ≤ hoy → 422 (futura); fecha > hoy+N → 422 (ventana). Setting LEÍDO
//        de TENANT_SETTINGS (no hardcodeado).
// ===========================================================================

describe('ProgramarVisitaUseCase — ventana de fecha desde el setting (3.3)', () => {
  it('debe_rechazar_422_cuando_la_fecha_de_visita_es_hoy', async () => {
    const { useCase, repos } = montar({});
    // AHORA = 2026-06-30 → fecha = hoy (mismo día) NO es futura.
    await expect(
      useCase.ejecutar(comando({ fechaVisita: new Date('2026-06-30T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(ProgramarVisitaValidacionError);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_422_cuando_la_fecha_de_visita_es_anterior_a_hoy', async () => {
    const { useCase, repos } = montar({});
    await expect(
      useCase.ejecutar(comando({ fechaVisita: new Date('2026-06-25T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(ProgramarVisitaValidacionError);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_422_cuando_la_fecha_de_visita_supera_hoy_mas_max_dias', async () => {
    const { useCase, repos } = montar({});
    // hoy + 10 días > hoy + 7 (max_dias_programar_visita del setting).
    await expect(
      useCase.ejecutar(comando({ fechaVisita: new Date('2026-07-10T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(ProgramarVisitaValidacionError);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_aceptar_la_fecha_limite_exacta_hoy_mas_max_dias', async () => {
    // hoy + 7 días = 2026-07-07 (borde superior INCLUSIVE de la ventana).
    const { useCase, repos } = montar({});
    await useCase.ejecutar(comando({ fechaVisita: new Date('2026-07-07T00:00:00.000Z') }));
    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
  });

  it('debe_leer_el_limite_de_TENANT_SETTINGS_y_no_hardcodearlo', async () => {
    const { useCase, tenantSettings } = montar({});
    await useCase.ejecutar(comando());
    expect(tenantSettings.obtener).toHaveBeenCalledWith(TENANT);
  });
});

// ===========================================================================
// 3.4 — UPDATE desde 2.b/2.c: → 2.v + campos de visita + UPDATE del ttl de la fila
//        existente de FECHA_BLOQUEADA a visita+1día 23:59:59 + AUDIT_LOG transicion.
// ===========================================================================

describe('ProgramarVisitaUseCase — desde 2.b/2.c actualiza el bloqueo existente (3.4)', () => {
  it.each(['2b', '2c'] as const)(
    'debe_pasar_a_2v_fijar_campos_de_visita_y_actualizar_el_ttl_desde_%s',
    async (sub) => {
      const { useCase, repos, uow } = montar({
        reserva: reservaOrigen({ subEstado: sub }),
        conBloqueo: true,
      });

      const out = await useCase.ejecutar(comando());

      // RESERVA → 2.v con los campos de visita y visita_realizada = false.
      expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
      const argsRes = repos.reservas.actualizar.mock.calls[0][0];
      expect(argsRes.subEstado).toBe('2v');
      expect((argsRes.visitaProgramadaFecha as Date).getTime()).toBe(
        FECHA_VISITA.getTime(),
      );
      expect(argsRes.visitaProgramadaHora).toBe(HORA_VISITA);
      expect(argsRes.visitaRealizada).toBe(false);
      expect(out.reserva.subEstado).toBe('2v');
      expect(out.reserva.visitaRealizada).toBe(false);

      // FECHA_BLOQUEADA: upsert en modo UPDATE (la fila ya existe) con TTL = visita+1d.
      expect(repos.fechaBloqueada.upsertTtl).toHaveBeenCalledTimes(1);
      const argsFb = repos.fechaBloqueada.upsertTtl.mock.calls[0][0];
      expect(argsFb.accion).toBe('update');
      expect(argsFb.tipoBloqueo).toBe('blando');
      expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
        ttlEsperadoVisita(FECHA_VISITA),
      );

      // Una sola unidad de trabajo (1 transacción).
      expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    },
  );

  it('debe_registrar_AUDIT_LOG_de_la_transicion_a_2v_con_origen_y_fecha_de_visita', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ subEstado: '2b' }),
      conBloqueo: true,
    });

    await useCase.ejecutar(comando());

    const registro = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === RESERVA_ID,
    )?.[0];
    expect(registro).toBeDefined();
    expect(registro.accion).toBe('transicion');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.datosAnteriores?.subEstado).toBe('2b');
    expect(registro.datosNuevos?.subEstado).toBe('2v');
    expect(
      new Date(registro.datosNuevos?.visitaProgramadaFecha as string).getTime(),
    ).toBe(FECHA_VISITA.getTime());
  });
});

// ===========================================================================
// 3.5 — INSERT desde 2.a (sin bloqueo): → 2.v + INSERT de una nueva fila
//        FECHA_BLOQUEADA (tipo_bloqueo='blando', TTL = visita+1día 23:59:59).
// ===========================================================================

describe('ProgramarVisitaUseCase — desde 2.a crea una nueva fila de bloqueo (3.5)', () => {
  it('debe_pasar_a_2v_e_insertar_una_nueva_fila_blanda_con_ttl_visita_mas_un_dia', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ subEstado: '2a' }),
      conBloqueo: false,
    });

    const out = await useCase.ejecutar(comando());

    expect(out.reserva.subEstado).toBe('2v');

    expect(repos.fechaBloqueada.upsertTtl).toHaveBeenCalledTimes(1);
    const argsFb = repos.fechaBloqueada.upsertTtl.mock.calls[0][0];
    expect(argsFb.accion).toBe('insert');
    expect(argsFb.tipoBloqueo).toBe('blando');
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      ttlEsperadoVisita(FECHA_VISITA),
    );
  });
});

// ===========================================================================
// 3.6 — Atomicidad: si una operación (RESERVA, FECHA_BLOQUEADA o AUDIT_LOG) falla,
//        el error se propaga para que la UoW haga rollback total (no se atrapa).
// ===========================================================================

describe('ProgramarVisitaUseCase — atomicidad / rollback (3.6)', () => {
  it.each(['actualizar', 'upsertTtl', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_la_operacion_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ conBloqueo: true, fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_SIMULADO_${op.toUpperCase()}`,
      );
    },
  );
});

// ===========================================================================
// 3.8 — E6 POST-COMMIT (D-6): tras una transición exitosa se dispara el envío de E6;
//        un fallo del proveedor NO revierte la transición (la transición ya commiteó
//        en la UoW; el envío va FUERA y es tolerante a fallo).
// ===========================================================================

describe('ProgramarVisitaUseCase — disparo de E6 post-commit (3.8)', () => {
  it('debe_disparar_E6_tras_el_commit_de_la_transicion_a_2v', async () => {
    const { useCase, confirmacionVisita } = montar({ conBloqueo: true });

    await useCase.ejecutar(comando());

    expect(confirmacionVisita.enviar).toHaveBeenCalledTimes(1);
    const args = confirmacionVisita.enviar.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.codigoEmail).toBe('E6');
  });

  it('debe_disparar_E6_DESPUES_de_cerrar_la_unidad_de_trabajo_no_dentro_de_la_tx', async () => {
    // Disparar E6 dentro de la tx acoplaría el commit a la latencia del proveedor.
    const { useCase, uow, confirmacionVisita } = montar({ conBloqueo: true });

    await useCase.ejecutar(comando());

    const ordenUow = uow.ejecutar.mock.invocationCallOrder[0];
    const ordenEmail = confirmacionVisita.enviar.mock.invocationCallOrder[0];
    expect(ordenEmail).toBeGreaterThan(ordenUow);
  });

  it('no_debe_revertir_la_transicion_si_el_proveedor_de_email_falla', async () => {
    const { useCase, repos } = montar({ conBloqueo: true }, /* emailFalla */ true);

    // El use-case resuelve OK pese al fallo de E6 (post-commit, tolerante).
    const out = await useCase.ejecutar(comando());
    expect(out.reserva.subEstado).toBe('2v');
    // La mutación de estado se aplicó (no se revirtió por el fallo del email).
    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    expect(repos.fechaBloqueada.upsertTtl).toHaveBeenCalledTimes(1);
  });
});
