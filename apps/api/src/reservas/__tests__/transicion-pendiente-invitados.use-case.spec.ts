/**
 * TESTS del caso de uso `TransicionPendienteInvitadosUseCase` (US-007 / UC-06) —
 * fase TDD RED. tasks.md Fase 3: 3.2 (TTL + audit), 3.3 (vaciado de cola A16 +
 * audit por descartada), 3.4 (atomicidad / rollback), 3.6 (precondición de bloqueo
 * 409), guarda de origen `2.b` (3.1 nivel aplicación), 3.7 (no-email D-7).
 *
 * Trazabilidad: US-007, spec-delta `consultas` (Requirements "Transición 2.b → 2.c …
 * extiende el bloqueo", "Vaciado atómico de la cola de espera al transicionar a 2.c
 * (A16)", "Atomicidad de las cuatro operaciones", "Guarda de origen — solo desde
 * 2.b", "Precondición de bloqueo — exige fecha bloqueada vigente", "El email de
 * solicitud de nº de invitados queda fuera de alcance"), design.md §D-3/§D-4/§D-5/§D-7.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES
 * viven en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se fija la
 * ORQUESTACIÓN: guarda de origen, precondición de bloqueo vigente, extensión de TTL
 * en RESERVA y FECHA_BLOQUEADA, vaciado de cola 2.d→2.y, auditoría (principal +
 * descartadas) y la AUSENCIA de cualquier email (D-7).
 *
 * Contrato del endpoint congelado (POST /reservas/{id}/pendiente-invitados):
 *   - 200 → { reserva (2.c, ttl nuevo), consultasDescartadas }.
 *   - 409 → `BloqueoNoVigenteError` (sin FECHA_BLOQUEADA activa o ttl_expiracion<ahora).
 *   - 422 → `TransicionPendienteInvitadosValidacionError` (RESERVA no en 2.b).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 *
 * RED: aún NO existe `application/transicion-pendiente-invitados.use-case.ts`. El
 * import falla en compilación y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  TransicionPendienteInvitadosUseCase,
  TransicionPendienteInvitadosValidacionError,
  BloqueoNoVigenteError,
  ReservaNoEncontradaError,
  type TransicionPendienteInvitadosComando,
  type TransicionPendienteInvitadosDeps,
  type RepositoriosPendienteInvitados,
  type UnidadDeTrabajoPendienteInvitadosPort,
  type ReservaPendienteInvitados,
  type BloqueoVigente,
  type ClockPort,
} from '../application/transicion-pendiente-invitados.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const CLIENTE_ID = 'cli-1';
const FECHA = new Date('2027-09-12T00:00:00.000Z');
const AHORA = new Date('2026-06-28T10:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;
const TTL_ACTUAL = new Date('2026-07-01T10:00:00.000Z'); // vigente: > AHORA
const TTL_EXPIRADO = new Date('2026-06-20T10:00:00.000Z'); // caducado: < AHORA

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

/** RESERVA semilla en su estado de origen (por defecto `consulta`/`2b` con TTL vigente). */
const reservaOrigen = (
  over: Partial<ReservaPendienteInvitados> = {},
): ReservaPendienteInvitados => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2b',
  ttlExpiracion: TTL_ACTUAL,
  fechaEvento: FECHA,
  posicionCola: null,
  consultaBloqueanteId: null,
  ...over,
});

/** Bloqueo vigente por defecto sobre la fecha de la RESERVA. */
const bloqueoVigente = (over: Partial<BloqueoVigente> = {}): BloqueoVigente => ({
  idBloqueo: 'blq-1',
  ttlExpiracion: TTL_ACTUAL,
  ...over,
});

interface ReposFake extends RepositoriosPendienteInvitados {
  reservas: {
    buscarPorId: jest.Mock;
    actualizar: jest.Mock;
  };
  fechaBloqueada: {
    leerBloqueoVigente: jest.Mock;
    extenderTtl: jest.Mock;
  };
  cola: {
    vaciarCola: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaPendienteInvitados | null;
  bloqueo?: BloqueoVigente | null;
  /** Filas de cola (2.d) descartadas que `vaciarCola` devuelve (ids 2d→2y). */
  descartadas?: ReadonlyArray<string>;
  /** Inyecta un fallo en una de las 4 operaciones para probar rollback (3.4). */
  fallarEn?: 'actualizar' | 'extenderTtl' | 'vaciarCola' | 'auditoria';
}): ReposFake => {
  const descartadas = opciones.descartadas ?? [];
  const fallo = (op: string): jest.Mock =>
    jest.fn(async () => {
      if (opciones.fallarEn === op) {
        throw new Error(`FALLO_SIMULADO_${op.toUpperCase()}`);
      }
      return undefined;
    });

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
      };
    }),
  };
  const fechaBloqueada = {
    leerBloqueoVigente: jest.fn(async () =>
      'bloqueo' in opciones ? (opciones.bloqueo ?? null) : bloqueoVigente(),
    ),
    extenderTtl: fallo('extenderTtl'),
  };
  const cola = {
    vaciarCola: jest.fn(async () => {
      if (opciones.fallarEn === 'vaciarCola') {
        throw new Error('FALLO_SIMULADO_VACIARCOLA');
      }
      return [...descartadas];
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
  return { reservas, fechaBloqueada, cola, auditoria };
};

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoPendienteInvitadosPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosPendienteInvitados) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const relojFijo: ClockPort = { ahora: () => AHORA };

const montar = (
  opciones: Parameters<typeof crearReposFake>[0] = {},
) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const tenantSettings = {
    obtener: jest.fn(async () => ({ ttlConsultaDias: 5, ttlPrereservaDias: 7 })),
  };
  const deps: TransicionPendienteInvitadosDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
    tenantSettings,
  };
  return {
    useCase: new TransicionPendienteInvitadosUseCase(deps),
    repos,
    uow,
    tenantSettings,
  };
};

const comando = (
  over: Partial<TransicionPendienteInvitadosComando> = {},
): TransicionPendienteInvitadosComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.1 — Guarda de origen: la RESERVA debe estar en 2.b (sin efectos si no) → 422.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — guarda de origen 2.b (3.1)', () => {
  it.each(['2a', '2c', '2v', '2x', '2y', '2z'] as const)(
    'debe_rechazar_con_validacion_y_sin_mutar_cuando_la_reserva_esta_en_%s',
    async (sub) => {
      const { useCase, repos } = montar({
        reserva: reservaOrigen({ subEstado: sub }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        TransicionPendienteInvitadosValidacionError,
      );

      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
      expect(repos.cola.vaciarCola).not.toHaveBeenCalled();
    },
  );

  it('debe_rechazar_cuando_la_reserva_esta_en_un_estado_terminal_inmutable', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ estado: 'reserva_cancelada', subEstado: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      TransicionPendienteInvitadosValidacionError,
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
// 3.6 — Precondición de bloqueo: exige FECHA_BLOQUEADA vigente (409).
//        Sin fila activa → 409; ttl_expiracion < ahora (expirado) → 409.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — precondición de bloqueo vigente (3.6)', () => {
  it('debe_rechazar_409_cuando_no_hay_FECHA_BLOQUEADA_activa', async () => {
    const { useCase, repos } = montar({ bloqueo: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      BloqueoNoVigenteError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.extenderTtl).not.toHaveBeenCalled();
    expect(repos.cola.vaciarCola).not.toHaveBeenCalled();
  });

  it('debe_rechazar_409_cuando_el_bloqueo_existe_pero_su_ttl_ya_expiro', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ ttlExpiracion: TTL_EXPIRADO }),
      bloqueo: bloqueoVigente({ ttlExpiracion: TTL_EXPIRADO }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      BloqueoNoVigenteError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 — Cola vacía: RESERVA 2.b→2.c + TTL extendido (base=ttl actual+5) en RESERVA
//        y FECHA_BLOQUEADA + AUDIT_LOG `transicion`, todo en una sola transacción.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — 2.b→2.c con cola vacía extiende TTL (3.2)', () => {
  it('debe_actualizar_la_reserva_a_2c_con_ttl_extendido_sobre_el_ttl_actual', async () => {
    const { useCase, repos, uow } = montar({ descartadas: [] });

    const out = await useCase.ejecutar(comando());

    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    const args = repos.reservas.actualizar.mock.calls[0][0];
    expect(args.subEstado).toBe('2c');
    // base = ttl ACTUAL (no now()) + ttl_consulta_dias (5).
    const ttlEsperado = TTL_ACTUAL.getTime() + 5 * DIA_MS;
    expect((args.ttlExpiracion as Date).getTime()).toBe(ttlEsperado);
    expect(out.reserva.subEstado).toBe('2c');
    // Toda la escritura ocurre DENTRO de una única unidad de trabajo (1 sola tx).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_extender_el_ttl_de_FECHA_BLOQUEADA_al_mismo_valor_que_la_reserva', async () => {
    const { useCase, repos } = montar({ descartadas: [] });

    await useCase.ejecutar(comando());

    expect(repos.fechaBloqueada.extenderTtl).toHaveBeenCalledTimes(1);
    const argsFb = repos.fechaBloqueada.extenderTtl.mock.calls[0][0];
    const argsRes = repos.reservas.actualizar.mock.calls[0][0];
    const ttlEsperado = TTL_ACTUAL.getTime() + 5 * DIA_MS;
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(ttlEsperado);
    // El mismo nuevo TTL en RESERVA y FECHA_BLOQUEADA (coherencia §D-4).
    expect((argsRes.ttlExpiracion as Date).getTime()).toBe(ttlEsperado);
  });

  it('debe_derivar_el_delta_del_ttl_de_TENANT_SETTINGS_y_no_hardcodearlo', async () => {
    const { useCase, tenantSettings } = montar({ descartadas: [] });

    await useCase.ejecutar(comando());

    expect(tenantSettings.obtener).toHaveBeenCalledWith(TENANT);
  });

  it('debe_registrar_AUDIT_LOG_de_la_transicion_2b_a_2c_con_el_nuevo_ttl', async () => {
    const { useCase, repos } = montar({ descartadas: [] });

    await useCase.ejecutar(comando());

    const principal = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === RESERVA_ID,
    );
    expect(principal).toBeDefined();
    const registro = principal![0];
    expect(registro.accion).toBe('transicion');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.datosAnteriores?.subEstado).toBe('2b');
    expect(registro.datosNuevos?.subEstado).toBe('2c');
    const ttlEsperado = TTL_ACTUAL.getTime() + 5 * DIA_MS;
    expect(new Date(registro.datosNuevos?.ttlExpiracion as string).getTime()).toBe(
      ttlEsperado,
    );
  });

  it('debe_vaciar_la_cola_aunque_este_vacia_sin_error_y_devolver_0_descartadas', async () => {
    const { useCase, repos } = montar({ descartadas: [] });

    const out = await useCase.ejecutar(comando());

    expect(repos.cola.vaciarCola).toHaveBeenCalledTimes(1);
    expect(out.consultasDescartadas).toBe(0);
  });
});

// ===========================================================================
// 3.3 — Vaciado de cola A16: N RESERVA en 2.d apuntando a la bloqueante → 2.y con
//        posicion_cola=NULL y consulta_bloqueante_id=NULL; AUDIT_LOG por descartada.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — vaciado atómico de cola A16 (3.3)', () => {
  it('debe_pasar_las_N_consultas_de_cola_a_2y_y_devolver_el_recuento', async () => {
    const descartadas = ['cola-1', 'cola-2', 'cola-3'];
    const { useCase, repos } = montar({ descartadas });

    const out = await useCase.ejecutar(comando());

    expect(repos.cola.vaciarCola).toHaveBeenCalledTimes(1);
    const args = repos.cola.vaciarCola.mock.calls[0][0];
    // El vaciado apunta a ESTA RESERVA como bloqueante.
    expect(args.consultaBloqueanteId).toBe(RESERVA_ID);
    expect(out.consultasDescartadas).toBe(descartadas.length);
  });

  it('debe_registrar_una_entrada_de_auditoria_por_cada_consulta_descartada_2d_a_2y', async () => {
    const descartadas = ['cola-1', 'cola-2'];
    const { useCase, repos } = montar({ descartadas });

    await useCase.ejecutar(comando());

    // 1 auditoría de la principal (2b→2c) + 1 por cada descartada (2d→2y).
    for (const id of descartadas) {
      const entrada = repos.auditoria.registrar.mock.calls.find(
        (c) => c[0].entidadId === id,
      );
      expect(entrada).toBeDefined();
      expect(entrada![0].accion).toBe('transicion');
      expect(entrada![0].datosAnteriores?.subEstado).toBe('2d');
      expect(entrada![0].datosNuevos?.subEstado).toBe('2y');
    }
    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(descartadas.length + 1);
  });
});

// ===========================================================================
// 3.4 — Atomicidad: si una de las 4 operaciones falla, la transacción propaga el
//        error (la UoW hace rollback). El use-case NO atrapa el fallo: el error sale
//        de `ejecutar` para que el adaptador revierta toda la transacción.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — atomicidad / rollback (3.4)', () => {
  it.each(['extenderTtl', 'vaciarCola', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_la_operacion_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ descartadas: ['cola-1'], fallarEn: op });

      // El fallo NO se atrapa: se propaga para que la UoW haga rollback total.
      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_SIMULADO_${op.toUpperCase()}`,
      );
    },
  );
});

// ===========================================================================
// 3.7 — D-7: la transición a 2.c NO dispara ningún email (gap de spec UC-06 p7).
//        Las deps del use-case NI SIQUIERA incluyen un puerto de email: no hay
//        forma de enviar ningún correo fuera del catálogo E1–E8.
// ===========================================================================

describe('TransicionPendienteInvitadosUseCase — no dispara ningún email (D-7) (3.7)', () => {
  it('no_debe_exponer_ningun_puerto_de_email_en_las_dependencias_del_use_case', () => {
    const { useCase } = montar({ descartadas: [] });

    // El use-case se construye SOLO con UoW + clock + tenantSettings: cualquier
    // dependencia con forma de "email" sería un email no catalogado (D-7).
    const deps = (useCase as unknown as { deps: Record<string, unknown> }).deps ?? {};
    const claves = Object.keys(deps).join(',').toLowerCase();
    expect(claves).not.toContain('email');
    expect(claves).not.toContain('confirmacion');
    expect(claves).not.toContain('comunicacion');
  });
});
