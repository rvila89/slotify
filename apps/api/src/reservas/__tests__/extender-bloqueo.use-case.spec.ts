/**
 * TESTS del caso de uso `ExtenderBloqueoUseCase` (US-006 / UC-05) — fase TDD RED.
 * tasks.md Fase 3: 3.2 (happy path), 3.3 (invariancia), 3.4 (atomicidad/rollback),
 * 3.6 (TTL expirado), 3.7 (estado sin bloqueo / firme), 3.8 (dias inválido).
 *
 * Trazabilidad: US-006, spec-delta `consultas` (Requirements "Extensión manual del
 * TTL del bloqueo activo prorroga RESERVA y FECHA_BLOQUEADA", "Auditoría de la
 * extensión en AUDIT_LOG con accion='actualizar'", "Atomicidad de las tres
 * operaciones", "TTL ya expirado — la extensión no está permitida", "Estado sin
 * bloqueo activo extensible", "Valor de extensión inválido"); design.md §D-1..§D-8.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES viven
 * en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN:
 * guarda declarativa de estado, precondición de fila blanda VIGENTE (`ttl > ahora`),
 * validación de `dias` entero ≥ 1, cálculo `nuevoTtl = ttl_ACTUAL + dias` (NO now()),
 * UPDATE de RESERVA + UPDATE de FECHA_BLOQUEADA al mismo nuevo valor, AUDIT_LOG
 * `actualizar` con `datos_anteriores/nuevos.ttlExpiracion`, e INVARIANCIA de
 * estado/subEstado/tipoBloqueo/fecha (prórroga PURA del TTL, NO transición).
 *
 * Contrato del endpoint congelado (POST /reservas/{id}/extender-bloqueo; body `{dias}`):
 *   - 200 → RESERVA con `ttlExpiracion` nuevo; estado/subEstado/tipoBloqueo/fecha sin cambios.
 *   - 409 → `BloqueoNoExtensibleError` (TTL expirado / bloqueo firme / sin fila bloqueante blanda vigente).
 *   - 422 → `ExtenderBloqueoValidacionError` (estado no extensible 2a/terminal; dias 0/negativo/no entero).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 *
 * RED: aún NO existe `application/extender-bloqueo.use-case.ts`. La batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ExtenderBloqueoUseCase,
  ExtenderBloqueoValidacionError,
  BloqueoNoExtensibleError,
  ReservaNoEncontradaError,
  type ExtenderBloqueoComando,
  type ExtenderBloqueoDeps,
  type RepositoriosExtenderBloqueo,
  type UnidadDeTrabajoExtenderBloqueoPort,
  type ReservaExtenderBloqueo,
  type BloqueoExtensible,
  type ClockPort,
} from '../application/extender-bloqueo.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

// Reloj fijo determinista: la vigencia del TTL se compara contra este `ahora`.
const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');

/** TTL vigente por defecto: ahora + 5 días. */
const TTL_VIGENTE = new Date(AHORA.getTime() + 5 * DIA_MS);
const DIAS = 7;

/** TTL esperado tras extender `n` días sobre el TTL ACTUAL (no sobre now()). */
const ttlExtendido = (base: Date, n: number): number => base.getTime() + n * DIA_MS;

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

/** RESERVA semilla con bloqueo blando vigente (por defecto `consulta`/`2b`). */
const reservaConBloqueo = (
  over: Partial<ReservaExtenderBloqueo> = {},
): ReservaExtenderBloqueo => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2b',
  ttlExpiracion: TTL_VIGENTE,
  fechaEvento: FECHA_EVENTO,
  ...over,
});

/** Fila FECHA_BLOQUEADA blanda vigente por defecto. */
const bloqueoBlando = (over: Partial<BloqueoExtensible> = {}): BloqueoExtensible => ({
  idBloqueo: 'blq-1',
  tipoBloqueo: 'blando',
  ttlExpiracion: TTL_VIGENTE,
  ...over,
});

interface ReposFake extends RepositoriosExtenderBloqueo {
  reservas: {
    buscarPorId: jest.Mock;
    extenderTtl: jest.Mock;
  };
  fechaBloqueada: {
    leerBloqueoVigente: jest.Mock;
    extenderTtl: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaExtenderBloqueo | null;
  /** Fila bloqueante; `null` = no hay fila (sin bloqueo activo → 409). */
  bloqueo?: BloqueoExtensible | null;
  /** Inyecta un fallo en una de las 3 operaciones para probar rollback (3.4). */
  fallarEn?: 'reservaExtenderTtl' | 'fechaExtenderTtl' | 'auditoria';
}): ReposFake => {
  const reservas = {
    buscarPorId: jest.fn(async () =>
      'reserva' in opciones ? (opciones.reserva ?? null) : reservaConBloqueo(),
    ),
    extenderTtl: jest.fn(async (p: Record<string, unknown>) => {
      if (opciones.fallarEn === 'reservaExtenderTtl') {
        throw new Error('FALLO_SIMULADO_RESERVAEXTENDERTTL');
      }
      const base = 'reserva' in opciones ? opciones.reserva : reservaConBloqueo();
      return { ...(base as ReservaExtenderBloqueo), ttlExpiracion: p.ttlExpiracion as Date };
    }),
  };
  const fechaBloqueada = {
    // null ≡ no hay fila bloqueante blanda vigente (409). objeto ≡ fila a extender.
    leerBloqueoVigente: jest.fn(async () =>
      'bloqueo' in opciones ? (opciones.bloqueo ?? null) : bloqueoBlando(),
    ),
    extenderTtl: jest.fn(async () => {
      if (opciones.fallarEn === 'fechaExtenderTtl') {
        throw new Error('FALLO_SIMULADO_FECHAEXTENDERTTL');
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
): UnidadDeTrabajoExtenderBloqueoPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosExtenderBloqueo) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const relojFijo: ClockPort = { ahora: () => AHORA };

const montar = (opciones: Parameters<typeof crearReposFake>[0] = {}) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const deps: ExtenderBloqueoDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
  };
  return { useCase: new ExtenderBloqueoUseCase(deps), repos, uow };
};

const comando = (
  over: Partial<ExtenderBloqueoComando> = {},
): ExtenderBloqueoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  dias: DIAS,
  ...over,
});

// ===========================================================================
// 3.2 — Happy path: extiende RESERVA + FECHA_BLOQUEADA al MISMO nuevo TTL (= ttl
//        ACTUAL + N días) y registra AUDIT_LOG `actualizar`. Una sola transacción.
// ===========================================================================

describe('ExtenderBloqueoUseCase — happy path prorroga RESERVA y FECHA_BLOQUEADA (3.2)', () => {
  it('debe_fijar_ttl_actual_mas_N_dias_en_RESERVA_y_FECHA_BLOQUEADA_al_mismo_valor', async () => {
    const { useCase, repos, uow } = montar({});

    const out = await useCase.ejecutar(comando());

    // RESERVA: nuevo TTL = ttl ACTUAL + N días (NO now()+N).
    expect(repos.reservas.extenderTtl).toHaveBeenCalledTimes(1);
    const argsRes = repos.reservas.extenderTtl.mock.calls[0][0];
    expect((argsRes.ttlExpiracion as Date).getTime()).toBe(
      ttlExtendido(TTL_VIGENTE, DIAS),
    );
    expect(out.reserva.ttlExpiracion?.getTime()).toBe(ttlExtendido(TTL_VIGENTE, DIAS));

    // FECHA_BLOQUEADA: se actualiza al MISMO nuevo valor.
    expect(repos.fechaBloqueada.extenderTtl).toHaveBeenCalledTimes(1);
    const argsFb = repos.fechaBloqueada.extenderTtl.mock.calls[0][0];
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      ttlExtendido(TTL_VIGENTE, DIAS),
    );

    // Una sola unidad de trabajo (1 transacción).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it.each(['2c', '2v'] as const)(
    'debe_extender_igual_desde_el_sub_estado_%s_de_consulta',
    async (sub) => {
      const { useCase, repos } = montar({
        reserva: reservaConBloqueo({ subEstado: sub }),
      });

      await useCase.ejecutar(comando());

      expect(repos.reservas.extenderTtl).toHaveBeenCalledTimes(1);
      expect(repos.fechaBloqueada.extenderTtl).toHaveBeenCalledTimes(1);
    },
  );

  it('debe_extender_igual_desde_pre_reserva', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConBloqueo({ estado: 'pre_reserva', subEstado: null }),
    });

    const out = await useCase.ejecutar(comando());

    expect(out.reserva.ttlExpiracion?.getTime()).toBe(ttlExtendido(TTL_VIGENTE, DIAS));
    expect(repos.fechaBloqueada.extenderTtl).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Auditoría — AUDIT_LOG `accion='actualizar'` con datos_anteriores/nuevos.ttl.
// ===========================================================================

describe('ExtenderBloqueoUseCase — auditoría accion=actualizar (3.2)', () => {
  it('debe_registrar_AUDIT_LOG_actualizar_con_ttl_anterior_y_nuevo', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const registro = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === RESERVA_ID,
    )?.[0];
    expect(registro).toBeDefined();
    expect(registro.accion).toBe('actualizar');
    expect(registro.entidad).toBe('RESERVA');
    // datos_anteriores.ttlExpiracion = valor previo; datos_nuevos.ttlExpiracion = nuevo.
    expect(new Date(registro.datosAnteriores?.ttlExpiracion as string).getTime()).toBe(
      TTL_VIGENTE.getTime(),
    );
    expect(new Date(registro.datosNuevos?.ttlExpiracion as string).getTime()).toBe(
      ttlExtendido(TTL_VIGENTE, DIAS),
    );
  });
});

// ===========================================================================
// 3.3 — Invariancia (D-8): la prórroga del TTL NO escribe estado/subEstado/
//        tipoBloqueo/fecha. Solo se tocan los TTL y el AUDIT_LOG.
// ===========================================================================

describe('ExtenderBloqueoUseCase — invariancia de estado/subEstado/tipoBloqueo/fecha (3.3)', () => {
  it('no_debe_cambiar_estado_ni_subEstado_de_la_RESERVA_en_el_resultado', async () => {
    const { useCase } = montar({
      reserva: reservaConBloqueo({ estado: 'consulta', subEstado: '2c' }),
    });

    const out = await useCase.ejecutar(comando());

    expect(out.reserva.estado).toBe('consulta');
    expect(out.reserva.subEstado).toBe('2c');
    expect(out.reserva.fechaEvento?.getTime()).toBe(FECHA_EVENTO.getTime());
  });

  it('no_debe_pasar_estado_subEstado_tipoBloqueo_ni_fecha_a_los_repositorios_de_extension', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    // El UPDATE de RESERVA solo lleva el id + el nuevo TTL (no estado/subEstado).
    const argsRes = repos.reservas.extenderTtl.mock.calls[0][0] as Record<string, unknown>;
    expect(argsRes).not.toHaveProperty('estado');
    expect(argsRes).not.toHaveProperty('subEstado');

    // El UPDATE de FECHA_BLOQUEADA solo lleva el nuevo TTL (no tipoBloqueo ni fecha nueva).
    const argsFb = repos.fechaBloqueada.extenderTtl.mock.calls[0][0] as Record<string, unknown>;
    expect(argsFb).not.toHaveProperty('tipoBloqueo');
  });
});

// ===========================================================================
// 3.4 — Atomicidad: si una de las 3 operaciones falla, el error se propaga para que
//        la UoW haga rollback total (no se atrapa; all-or-nothing).
// ===========================================================================

describe('ExtenderBloqueoUseCase — atomicidad / rollback (3.4)', () => {
  it.each(['reservaExtenderTtl', 'fechaExtenderTtl', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_la_operacion_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_SIMULADO_${op.toUpperCase()}`,
      );
    },
  );
});

// ===========================================================================
// 3.6 — Edge 409: TTL ya expirado → rechazo (BloqueoNoExtensibleError), sin mutar.
// ===========================================================================

describe('ExtenderBloqueoUseCase — TTL expirado → 409 sin efectos (3.6)', () => {
  it('debe_rechazar_409_cuando_el_ttl_de_la_RESERVA_ya_expiro_y_no_mutar', async () => {
    const ttlExpirado = new Date(AHORA.getTime() - DIA_MS);
    const { useCase, repos } = montar({
      reserva: reservaConBloqueo({ ttlExpiracion: ttlExpirado }),
      bloqueo: bloqueoBlando({ ttlExpiracion: ttlExpirado }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );
    expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_409_cuando_no_hay_fila_bloqueante_blanda_vigente_y_no_mutar', async () => {
    const { useCase, repos } = montar({ bloqueo: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );
    expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — Edge 409/422: bloqueo firme (reserva_confirmada) y estado no extensible.
// ===========================================================================

describe('ExtenderBloqueoUseCase — bloqueo firme reserva_confirmada → 409 (3.7)', () => {
  it('debe_rechazar_409_cuando_la_reserva_esta_confirmada_con_bloqueo_firme', async () => {
    // reserva_confirmada: bloqueo firme sin TTL → no hay TTL que extender.
    const { useCase, repos } = montar({
      reserva: reservaConBloqueo({
        estado: 'reserva_confirmada',
        subEstado: null,
        ttlExpiracion: null,
      }),
      bloqueo: bloqueoBlando({ tipoBloqueo: 'firme', ttlExpiracion: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );
    expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
  });
});

describe('ExtenderBloqueoUseCase — estado sin bloqueo extensible (2a/terminal) → 422 (3.7)', () => {
  const noExtensibles: ReadonlyArray<{
    estado: EstadoReserva;
    subEstado: SubEstadoConsulta | null;
  }> = [
    { estado: 'consulta', subEstado: '2a' },
    { estado: 'consulta', subEstado: '2d' },
    { estado: 'consulta', subEstado: '2x' },
    { estado: 'consulta', subEstado: '2y' },
    { estado: 'consulta', subEstado: '2z' },
    { estado: 'reserva_cancelada', subEstado: null },
    { estado: 'reserva_completada', subEstado: null },
  ];

  it.each(noExtensibles)(
    'debe_rechazar_422_y_no_mutar_cuando_la_reserva_esta_en_$estado_$subEstado',
    async ({ estado, subEstado }) => {
      const { useCase, repos } = montar({
        reserva: reservaConBloqueo({ estado, subEstado }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ExtenderBloqueoValidacionError,
      );
      expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 404 — RESERVA inexistente para el tenant (RLS: cross-tenant invisible).
// ===========================================================================

describe('ExtenderBloqueoUseCase — RESERVA inexistente → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase, repos } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.8 — Edge 422: dias inválido (0, negativo, no entero) → validación, sin efectos.
//        Validación DEFENSIVA en dominio (además del DTO).
// ===========================================================================

describe('ExtenderBloqueoUseCase — dias inválido → 422 sin efectos (3.8)', () => {
  it.each([0, -1, -10, 1.5, 3.7, Number.NaN])(
    'debe_rechazar_422_cuando_dias_es_%p_sin_tocar_la_BD',
    async (dias) => {
      const { useCase, repos } = montar({});

      await expect(
        useCase.ejecutar(comando({ dias: dias as number })),
      ).rejects.toBeInstanceOf(ExtenderBloqueoValidacionError);

      expect(repos.reservas.extenderTtl).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_aceptar_dias_minimo_valido_igual_a_1', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando({ dias: 1 }));

    const argsRes = repos.reservas.extenderTtl.mock.calls[0][0];
    expect((argsRes.ttlExpiracion as Date).getTime()).toBe(ttlExtendido(TTL_VIGENTE, 1));
  });
});
