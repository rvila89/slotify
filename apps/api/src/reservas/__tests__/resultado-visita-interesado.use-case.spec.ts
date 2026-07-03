/**
 * TESTS del caso de uso `RegistrarResultadoVisitaUseCase` (resultado "cliente
 * interesado", `2.v` → `2.b`) (US-009 / UC-08) — fase TDD RED. tasks.md Fase 3:
 * 3.1 (guarda de origen nivel aplicación), 3.2 (transición + TTL fresco + UPDATE
 * FECHA_BLOQUEADA + AUDIT_LOG), 3.3 (TTL fresco desde now, no acumulado ni derivado
 * de visita_programada_fecha), 3.4 (FA registro antes de la fecha de visita), 3.5
 * (atomicidad/rollback), 3.7 (E7 post-commit + tolerancia a fallo).
 *
 * Trazabilidad: US-009, spec-delta `consultas` (Requirements "Transición 2.v → 2.b
 * registra 'cliente interesado'", "El bloqueo de fecha actualiza su TTL al mismo valor
 * fresco y conserva tipo_bloqueo blando", "Guarda de origen — solo desde 2.v", "El
 * registro no depende de que haya llegado la fecha de visita", "Atomicidad de la
 * transición 2.v → 2.b"), spec-delta `comunicaciones` (Requirements "La transición
 * dispara E7 y lo registra en COMUNICACION", "El envío de E7 es posterior al commit y
 * su fallo no revierte la transición"); design.md §D-1..§D-4.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES viven
 * en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN:
 * guarda de origen MONO-estado (`2v`), mutación de RESERVA (`2b` + `visita_realizada=true`
 * + `ttl_expiracion = now + ttl_consulta_dias`), UPDATE del ttl de la fila existente de
 * FECHA_BLOQUEADA al MISMO valor (nunca insert/delete; `tipo_bloqueo` permanece 'blando'),
 * AUDIT_LOG `transicion` (datos antes/después) y el disparo de E7 POST-COMMIT (un fallo
 * del proveedor de email NO revierte la transición, D-4).
 *
 * Contrato del endpoint CONGELADO (PATCH /reservas/{id}/visita; body `{resultado:'interesado'}`;
 * operationId `registrarResultadoVisita`):
 *   - 200 → RESERVA (2.b, visitaRealizada=true, ttlExpiracion fresco).
 *   - 422 → `ResultadoVisitaValidacionError` (origen no en 2v / terminal / resultado
 *     no soportado).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 *
 * RED: aún NO existe `application/registrar-resultado-visita.use-case.ts`. El import
 * falla en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN
 * es de `backend-developer`.
 */
import {
  RegistrarResultadoVisitaUseCase,
  ResultadoVisitaValidacionError,
  ReservaNoEncontradaError,
  type RegistrarResultadoVisitaComando,
  type RegistrarResultadoVisitaDeps,
  type RepositoriosResultadoVisita,
  type UnidadDeTrabajoResultadoVisitaPort,
  type ReservaResultadoVisita,
  type EnviarConfirmacionResultadoVisitaPort,
  type ClockPort,
} from '../application/registrar-resultado-visita.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2v';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

// Reloj fijo determinista: el TTL fresco se calcula desde este `ahora`.
const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
const TTL_CONSULTA_DIAS = 3;

/** TTL fresco esperado: now + ttl_consulta_dias (calculado desde `ahora`). */
const ttlFrescoEsperado = (ahora: Date, dias: number): number =>
  ahora.getTime() + dias * DIA_MS;

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

/**
 * RESERVA semilla en su estado de origen (por defecto `consulta`/`2v`, con la visita
 * programada y su TTL de 2.v = día post-visita, fijado por US-008). El TTL previo es
 * DELIBERADAMENTE distinto de `now + ttl_consulta_dias` para probar que el nuevo TTL es
 * fresco (no acumulado ni derivado del anterior ni de la fecha de visita).
 */
const reservaOrigen = (
  over: Partial<ReservaResultadoVisita> = {},
): ReservaResultadoVisita => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2v',
  ttlExpiracion: new Date('2026-07-02T23:59:59.000Z'), // día post-visita (US-008)
  fechaEvento: FECHA_EVENTO,
  visitaProgramadaFecha: new Date('2026-07-01T00:00:00.000Z'),
  visitaProgramadaHora: '17:30',
  visitaRealizada: false,
  ...over,
});

interface ReposFake extends RepositoriosResultadoVisita {
  reservas: {
    buscarPorId: jest.Mock;
    actualizar: jest.Mock;
  };
  fechaBloqueada: {
    leerBloqueoVigente: jest.Mock;
    actualizarTtl: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaResultadoVisita | null;
  /** Inyecta un fallo en una de las operaciones para probar rollback (3.5). */
  fallarEn?: 'actualizar' | 'actualizarTtl' | 'auditoria';
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
        visitaRealizada: p.visitaRealizada as boolean,
      };
    }),
  };
  const fechaBloqueada = {
    // La RESERVA viene de 2.v: la fila de FECHA_BLOQUEADA SIEMPRE existe (no hay rama
    // de INSERT). `leerBloqueoVigente` toma el FOR UPDATE sobre la fila bloqueante.
    leerBloqueoVigente: jest.fn(async () => ({
      idBloqueo: 'blq-1',
      tipoBloqueo: 'blando' as const,
      ttlExpiracion: new Date('2026-07-02T23:59:59.000Z'),
    })),
    actualizarTtl: jest.fn(async () => {
      if (opciones.fallarEn === 'actualizarTtl') {
        throw new Error('FALLO_SIMULADO_ACTUALIZARTTL');
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
): UnidadDeTrabajoResultadoVisitaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosResultadoVisita) => Promise<T>,
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
      ttlConsultaDias: TTL_CONSULTA_DIAS,
      ttlPrereservaDias: 7,
      maxDiasProgramarVisita: 7,
    })),
  };
  // Puerto de E7 POST-COMMIT (modo fake): no envía red. Si `emailFalla`, simula un
  // fallo del proveedor para comprobar que NO revierte la transición (D-4).
  const confirmacionResultado: EnviarConfirmacionResultadoVisitaPort & {
    enviar: jest.Mock;
  } = {
    enviar: jest.fn(async () => {
      if (emailFalla) {
        return { estado: 'fallido' as const, fechaEnvio: null };
      }
      return { estado: 'enviado' as const, fechaEnvio: AHORA };
    }),
  };
  const deps: RegistrarResultadoVisitaDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
    tenantSettings,
    confirmacionResultado,
  };
  return {
    useCase: new RegistrarResultadoVisitaUseCase(deps),
    repos,
    uow,
    tenantSettings,
    confirmacionResultado,
  };
};

const comando = (
  over: Partial<RegistrarResultadoVisitaComando> = {},
): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  resultado: 'interesado',
  ...over,
});

// ===========================================================================
// 3.1 — Guarda de origen: SOLO 2v. Resto (2a/2b/2c/2d) y terminales → 422 sin mutar.
//        404 si la RESERVA no existe para el tenant (RLS).
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — guarda de origen mono-estado {2v} (3.1)', () => {
  it.each(['2a', '2b', '2c', '2d'] as const)(
    'debe_rechazar_422_y_sin_mutar_cuando_la_reserva_esta_en_%s',
    async (sub) => {
      const { useCase, repos } = montar({
        reserva: reservaOrigen({ subEstado: sub }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ResultadoVisitaValidacionError,
      );

      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.actualizarTtl).not.toHaveBeenCalled();
    },
  );

  it.each(['2x', '2y', '2z'] as const)(
    'debe_rechazar_422_cuando_la_reserva_esta_en_el_sub_estado_terminal_%s',
    async (sub) => {
      const { useCase, repos } = montar({
        reserva: reservaOrigen({ subEstado: sub }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ResultadoVisitaValidacionError,
      );
      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    },
  );

  it('debe_rechazar_422_cuando_la_reserva_esta_en_un_estado_terminal_inmutable', async () => {
    const { useCase, repos } = montar({
      reserva: reservaOrigen({ estado: 'reserva_cancelada', subEstado: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ResultadoVisitaValidacionError,
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
// 3.1 — Resultado no soportado por esta US → 422 sin mutar. Esta US solo cubre
//        "interesado"; "reserva"/"descarte" (US-010/US-011) aún no se implementan.
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — resultado no soportado → 422 (3.1)', () => {
  it.each(['reserva', 'descarte', 'cualquier-otro'] as const)(
    'debe_rechazar_422_cuando_el_resultado_es_%s_no_soportado_en_esta_US',
    async (resultado) => {
      const { useCase, repos } = montar({});

      await expect(
        useCase.ejecutar(
          comando({ resultado: resultado as RegistrarResultadoVisitaComando['resultado'] }),
        ),
      ).rejects.toBeInstanceOf(ResultadoVisitaValidacionError);
      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 3.2 — Transición desde 2.v: → 2.b + visita_realizada=true + ttl_expiracion fresco
//        (now + ttl_consulta_dias) + UPDATE del ttl de la fila existente de
//        FECHA_BLOQUEADA al MISMO valor + AUDIT_LOG transicion. Una sola tx.
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — transición 2.v → 2.b (3.2)', () => {
  it('debe_pasar_a_2b_fijar_visita_realizada_true_y_ttl_fresco', async () => {
    const { useCase, repos, uow } = montar({});

    const out = await useCase.ejecutar(comando());

    // RESERVA → 2.b con visita_realizada = true y TTL fresco (now + ttl_consulta_dias).
    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    const argsRes = repos.reservas.actualizar.mock.calls[0][0];
    expect(argsRes.subEstado).toBe('2b');
    expect(argsRes.visitaRealizada).toBe(true);
    expect((argsRes.ttlExpiracion as Date).getTime()).toBe(
      ttlFrescoEsperado(AHORA, TTL_CONSULTA_DIAS),
    );
    expect(out.reserva.subEstado).toBe('2b');
    expect(out.reserva.visitaRealizada).toBe(true);

    // Una sola unidad de trabajo (1 transacción).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_actualizar_el_ttl_de_la_fila_existente_de_FECHA_BLOQUEADA_al_mismo_valor_fresco', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    // FECHA_BLOQUEADA: UPDATE PURO (misma fila) al MISMO valor que RESERVA.ttl_expiracion.
    expect(repos.fechaBloqueada.actualizarTtl).toHaveBeenCalledTimes(1);
    const argsFb = repos.fechaBloqueada.actualizarTtl.mock.calls[0][0];
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      ttlFrescoEsperado(AHORA, TTL_CONSULTA_DIAS),
    );
    // El TTL escrito en RESERVA y en FECHA_BLOQUEADA es IDÉNTICO (única fuente de verdad).
    const argsRes = repos.reservas.actualizar.mock.calls[0][0];
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      (argsRes.ttlExpiracion as Date).getTime(),
    );
  });

  it('debe_mantener_tipo_bloqueo_blando_y_no_insertar_ni_eliminar_filas', async () => {
    // La RESERVA viene de 2.v: la operación es UPDATE puro, nunca INSERT/DELETE. El
    // repositorio expone SOLO `actualizarTtl` (no `upsertTtl`/`insertar`/`eliminar`):
    // se prueba que el tipo_bloqueo NO se toca (permanece 'blando').
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const argsFb = repos.fechaBloqueada.actualizarTtl.mock.calls[0][0];
    // Si el use-case pasara un tipoBloqueo, DEBE ser 'blando' (no promociona a firme).
    if ('tipoBloqueo' in argsFb) {
      expect(argsFb.tipoBloqueo).toBe('blando');
    }
    // El identificador de la fila existente se reutiliza (UPDATE, no fila nueva).
    expect(repos.fechaBloqueada.leerBloqueoVigente).toHaveBeenCalledTimes(1);
  });

  it('debe_registrar_AUDIT_LOG_de_la_transicion_2v_a_2b_con_datos_antes_y_despues', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const registro = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === RESERVA_ID,
    )?.[0];
    expect(registro).toBeDefined();
    expect(registro.accion).toBe('transicion');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.datosAnteriores?.subEstado).toBe('2v');
    expect(registro.datosAnteriores?.visitaRealizada).toBe(false);
    expect(registro.datosNuevos?.subEstado).toBe('2b');
    expect(registro.datosNuevos?.visitaRealizada).toBe(true);
  });

  it('debe_leer_ttl_consulta_dias_de_TENANT_SETTINGS_y_no_hardcodearlo', async () => {
    const { useCase, tenantSettings } = montar({});
    await useCase.ejecutar(comando());
    expect(tenantSettings.obtener).toHaveBeenCalledWith(TENANT);
  });
});

// ===========================================================================
// 3.3 — TTL FRESCO: el nuevo ttl_expiracion = now + ttl_consulta_dias, INDEPENDIENTE
//        del ttl_expiracion previo (día post-visita) y de visita_programada_fecha.
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — TTL fresco desde now (3.3)', () => {
  it('no_debe_acumular_sobre_el_ttl_previo_ni_derivarlo_de_visita_programada_fecha', async () => {
    // TTL previo = 2026-07-02 (día post-visita); visita_programada_fecha = 2026-07-01.
    // El nuevo TTL debe ser now (2026-06-30) + 3 días = 2026-07-03, NO 2026-07-02 + 3,
    // NI 2026-07-01 + algo.
    const { useCase, repos } = montar({
      reserva: reservaOrigen({
        ttlExpiracion: new Date('2026-07-02T23:59:59.000Z'),
        visitaProgramadaFecha: new Date('2026-07-01T00:00:00.000Z'),
      }),
    });

    await useCase.ejecutar(comando());

    const nuevoTtl = (
      repos.reservas.actualizar.mock.calls[0][0].ttlExpiracion as Date
    ).getTime();
    expect(nuevoTtl).toBe(ttlFrescoEsperado(AHORA, TTL_CONSULTA_DIAS));

    // No coincide con "ttl previo + dias" (acumulado) ni con la fecha de visita.
    const ttlAcumulado =
      new Date('2026-07-02T23:59:59.000Z').getTime() + TTL_CONSULTA_DIAS * DIA_MS;
    expect(nuevoTtl).not.toBe(ttlAcumulado);
    expect(nuevoTtl).not.toBe(new Date('2026-07-01T00:00:00.000Z').getTime());
  });

  it('debe_recalcular_el_mismo_ttl_fresco_aunque_cambie_el_valor_previo', async () => {
    // Con un TTL previo MUY distinto, el resultado sigue siendo now + ttl_consulta_dias.
    const { useCase, repos } = montar({
      reserva: reservaOrigen({
        ttlExpiracion: new Date('2030-01-01T00:00:00.000Z'),
      }),
    });

    await useCase.ejecutar(comando());

    const nuevoTtl = (
      repos.reservas.actualizar.mock.calls[0][0].ttlExpiracion as Date
    ).getTime();
    expect(nuevoTtl).toBe(ttlFrescoEsperado(AHORA, TTL_CONSULTA_DIAS));
  });
});

// ===========================================================================
// 3.4 — FA: registro ANTES de la fecha de visita (visita_programada_fecha > hoy) NO
//        bloquea el registro; la transición procede y el TTL se calcula desde now.
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — registro antes de la fecha de visita (3.4)', () => {
  it('debe_permitir_el_registro_cuando_visita_programada_fecha_es_futura', async () => {
    // visita_programada_fecha = hoy + 2 días (aún no ha llegado en el calendario).
    const { useCase, repos } = montar({
      reserva: reservaOrigen({
        visitaProgramadaFecha: new Date(AHORA.getTime() + 2 * DIA_MS),
      }),
    });

    const out = await useCase.ejecutar(comando());

    expect(out.reserva.subEstado).toBe('2b');
    expect(out.reserva.visitaRealizada).toBe(true);
    // El TTL sigue siendo fresco desde now, NO derivado de la fecha de visita futura.
    const nuevoTtl = (
      repos.reservas.actualizar.mock.calls[0][0].ttlExpiracion as Date
    ).getTime();
    expect(nuevoTtl).toBe(ttlFrescoEsperado(AHORA, TTL_CONSULTA_DIAS));
  });
});

// ===========================================================================
// 3.5 — Atomicidad: si una operación (RESERVA, FECHA_BLOQUEADA o AUDIT_LOG) falla, el
//        error se propaga para que la UoW haga rollback total (no se atrapa).
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — atomicidad / rollback (3.5)', () => {
  it.each(['actualizar', 'actualizarTtl', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_la_operacion_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_SIMULADO_${op.toUpperCase()}`,
      );
    },
  );

  it('no_debe_disparar_E7_si_la_transaccion_de_estado_falla', async () => {
    // Si la tx revierte, NO hay commit → no se dispara E7 (post-commit).
    const { useCase, confirmacionResultado } = montar({ fallarEn: 'actualizar' });

    await useCase.ejecutar(comando()).catch(() => undefined);

    expect(confirmacionResultado.enviar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — E7 POST-COMMIT (D-4): tras una transición exitosa se dispara el envío de E7;
//        un fallo del proveedor NO revierte la transición (la transición ya commiteó).
// ===========================================================================

describe('RegistrarResultadoVisitaUseCase — disparo de E7 post-commit (3.7)', () => {
  it('debe_disparar_E7_tras_el_commit_de_la_transicion_a_2b', async () => {
    const { useCase, confirmacionResultado } = montar({});

    await useCase.ejecutar(comando());

    expect(confirmacionResultado.enviar).toHaveBeenCalledTimes(1);
    const args = confirmacionResultado.enviar.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.codigoEmail).toBe('E7');
  });

  it('debe_disparar_E7_DESPUES_de_cerrar_la_unidad_de_trabajo_no_dentro_de_la_tx', async () => {
    // Disparar E7 dentro de la tx acoplaría el commit a la latencia del proveedor.
    const { useCase, uow, confirmacionResultado } = montar({});

    await useCase.ejecutar(comando());

    const ordenUow = uow.ejecutar.mock.invocationCallOrder[0];
    const ordenEmail = confirmacionResultado.enviar.mock.invocationCallOrder[0];
    expect(ordenEmail).toBeGreaterThan(ordenUow);
  });

  it('no_debe_revertir_la_transicion_si_el_proveedor_de_email_falla', async () => {
    const { useCase, repos } = montar({}, /* emailFalla */ true);

    // El use-case resuelve OK pese al fallo de E7 (post-commit, tolerante).
    const out = await useCase.ejecutar(comando());
    expect(out.reserva.subEstado).toBe('2b');
    expect(out.reserva.visitaRealizada).toBe(true);
    // La mutación de estado se aplicó (no se revirtió por el fallo del email).
    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    expect(repos.fechaBloqueada.actualizarTtl).toHaveBeenCalledTimes(1);
  });
});
