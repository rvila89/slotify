/**
 * TESTS del caso de uso `RegistrarResultadoVisitaUseCase` para el resultado «reserva
 * inmediata» (`2.v` → `pre_reserva`) (US-010 / UC-08 FA-08 / UC-14) — fase TDD RED.
 * tasks.md Fase 3: 3.1 (guarda de origen nivel aplicación + habilitar el valor),
 * 3.2 (validación de datos obligatorios UC-14 → 422 con camposFaltantes), 3.3
 * (transición + TTL de 7 días leído del setting + UPDATE FECHA_BLOQUEADA + AUDIT_LOG),
 * 3.4 (vaciado de cola A16), 3.5 (atomicidad/rollback).
 *
 * Trazabilidad: US-010, spec-delta `consultas` (Requirements "Transición 2.v →
 * pre_reserva registra 'reserva inmediata'", "La transición a pre_reserva exige datos
 * obligatorios completos (validación UC-14)", "El bloqueo de fecha actualiza su TTL a 7
 * días", "Vaciado atómico de la cola de espera (A16)", "Guarda de origen — solo desde
 * 2.v", "Atomicidad de la transición 2.v → pre_reserva"); design.md §D-1..§D-5.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES viven
 * en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN:
 * guarda de origen MONO-estado (`2v`), validación de datos obligatorios UC-14 (RESERVA +
 * CLIENTE) reutilizando el patrón `camposFaltantes`, mutación de la RESERVA
 * (`estado='pre_reserva'` + `subEstado=NULL` + `visita_realizada=true` + `ttl = now +
 * ttl_prereserva_dias`), UPDATE del ttl de la fila existente de FECHA_BLOQUEADA al MISMO
 * valor (`tipo_bloqueo` permanece 'blando'), vaciado de cola A16 (`2.d → 2.y`), AUDIT_LOG
 * `transicion` (principal + una por cada consulta vaciada) y la AUSENCIA de email (a
 * diferencia de US-009/interesado, US-010 NO dispara E7 ni E2).
 *
 * Contrato del endpoint CONGELADO (PATCH /reservas/{id}/visita; body
 * `{resultado:'reserva_inmediata'}`; operationId `registrarResultadoVisita`):
 *   - 200 → RESERVA (pre_reserva, subEstado=null, visitaRealizada=true, ttlExpiracion 7d).
 *   - 422 → `ResultadoVisitaValidacionError` (origen no en 2v / terminal / `descarta` no
 *     soportado) o `DatosObligatoriosIncompletosError` (datos UC-14 con camposFaltantes).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 *
 * RED: hoy `registrar-resultado-visita.use-case.ts` RECHAZA `reserva_inmediata` con 422
 * (solo implementa `interesado`) y NO expone los puertos nuevos (cola, cliente,
 * ttl_prereserva, error de datos obligatorios). El import de los símbolos nuevos falla
 * en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  RegistrarResultadoVisitaUseCase,
  ResultadoVisitaValidacionError,
  ReservaNoEncontradaError,
  DatosObligatoriosIncompletosError,
  type RegistrarResultadoVisitaComando,
  type RegistrarResultadoVisitaDeps,
  type RepositoriosResultadoVisita,
  type UnidadDeTrabajoResultadoVisitaPort,
  type ReservaResultadoVisita,
  type ClienteResultadoVisita,
  type EnviarConfirmacionResultadoVisitaPort,
  type ClockPort,
} from '../application/registrar-resultado-visita.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2v';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

// Reloj fijo determinista: el TTL de pre_reserva se calcula desde este `ahora`.
const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
// TTLs DISTINTOS a propósito: el de pre_reserva (7) es el que debe usarse; el de
// consulta (3) es una trampa (US-010 NO lo usa).
const TTL_PRERESERVA_DIAS = 7;
const TTL_CONSULTA_DIAS = 3;

/** TTL esperado de pre_reserva: now + ttl_prereserva_dias (desde `ahora`). */
const ttlPrereservaEsperado = (ahora: Date, dias: number): number =>
  ahora.getTime() + dias * DIA_MS;

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

/**
 * RESERVA semilla en su estado de origen (por defecto `consulta`/`2v`, con la visita
 * programada, su TTL de 2.v = día post-visita, y TODOS los datos obligatorios UC-14
 * completos). El TTL previo es DELIBERADAMENTE distinto de `now + ttl_prereserva_dias`
 * para probar que el nuevo TTL es fresco.
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
  duracionHoras: 8,
  tipoEvento: 'boda',
  numAdultosNinosMayores4: 40,
  visitaProgramadaFecha: new Date('2026-07-01T00:00:00.000Z'),
  visitaProgramadaHora: '17:30',
  visitaRealizada: false,
  ...over,
});

/** CLIENTE semilla con los datos fiscales UC-14 completos (por defecto). */
const clienteCompleto = (
  over: Partial<ClienteResultadoVisita> = {},
): ClienteResultadoVisita => ({
  idCliente: CLIENTE_ID,
  tenantId: TENANT,
  dniNif: '12345678Z',
  direccion: 'C/ Mayor 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
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
  cola: {
    vaciar: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaResultadoVisita | null;
  /** Ids de las consultas en cola (2d) que el vaciado devuelve como descartadas. */
  colaDescartadas?: ReadonlyArray<string>;
  /** Inyecta un fallo en una de las operaciones para probar rollback (3.5). */
  fallarEn?: 'actualizar' | 'actualizarTtl' | 'vaciar' | 'auditoria';
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
        estado: p.estado,
        subEstado: (p.subEstado as string | null) ?? null,
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
  const cola = {
    vaciar: jest.fn(async () => {
      if (opciones.fallarEn === 'vaciar') {
        throw new Error('FALLO_SIMULADO_VACIAR');
      }
      return { descartadas: opciones.colaDescartadas ?? [] };
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
  opciones: Parameters<typeof crearReposFake>[0] & {
    cliente?: ClienteResultadoVisita | null;
  } = {},
) => {
  const repos = crearReposFake(opciones);
  const uow = crearUowFake(repos);
  const tenantSettings = {
    obtener: jest.fn(async () => ({
      ttlConsultaDias: TTL_CONSULTA_DIAS,
      ttlPrereservaDias: TTL_PRERESERVA_DIAS,
      maxDiasProgramarVisita: 7,
    })),
  };
  // Cargador del CLIENTE para la validación de datos obligatorios UC-14. Por defecto
  // devuelve un CLIENTE fiscalmente completo.
  const cargarCliente = {
    obtener: jest.fn(async () =>
      'cliente' in opciones ? (opciones.cliente ?? null) : clienteCompleto(),
    ),
  };
  // Puerto de email (E7) del flujo "interesado". En US-010 (reserva_inmediata) NO debe
  // dispararse ningún email; el espía comprueba que NO se invoca.
  const confirmacionResultado: EnviarConfirmacionResultadoVisitaPort & {
    enviar: jest.Mock;
  } = {
    enviar: jest.fn(async () => ({ estado: 'enviado' as const, fechaEnvio: AHORA })),
  };
  const deps: RegistrarResultadoVisitaDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
    tenantSettings,
    cargarCliente,
    confirmacionResultado,
  };
  return {
    useCase: new RegistrarResultadoVisitaUseCase(deps),
    repos,
    uow,
    tenantSettings,
    cargarCliente,
    confirmacionResultado,
  };
};

const comando = (
  over: Partial<RegistrarResultadoVisitaComando> = {},
): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  resultado: 'reserva_inmediata',
  ...over,
});

// ===========================================================================
// 3.1 — Guarda de origen: SOLO 2v. Resto (2a/2b/2c/2d) y terminales → 422 sin mutar.
//        404 si la RESERVA no existe para el tenant (RLS).
// ===========================================================================

describe('RegistrarResultadoVisita reserva_inmediata — guarda de origen mono-estado {2v} (3.1)', () => {
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
      expect(repos.cola.vaciar).not.toHaveBeenCalled();
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

  it.each([
    'pre_reserva',
    'reserva_confirmada',
    'reserva_cancelada',
    'reserva_completada',
  ] as const)(
    'debe_rechazar_422_cuando_la_reserva_esta_en_el_estado_ya_avanzado_o_terminal_%s',
    async (estado) => {
      const { useCase, repos } = montar({
        reserva: reservaOrigen({ estado, subEstado: null }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        ResultadoVisitaValidacionError,
      );
      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    },
  );

  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    // RLS / multi-tenancy: una RESERVA de otro tenant es invisible → 404.
    const { useCase, repos } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_seguir_rechazando_descarta_como_resultado_no_soportado_en_esta_US', async () => {
    // US-011 (`descarta`) aún no implementada → 422; NO se muta nada.
    const { useCase, repos } = montar({});

    await expect(
      useCase.ejecutar(
        comando({
          resultado: 'descarta' as RegistrarResultadoVisitaComando['resultado'],
        }),
      ),
    ).rejects.toBeInstanceOf(ResultadoVisitaValidacionError);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 — Validación de datos obligatorios UC-14 (D-4): con RESERVA/CLIENTE incompletos
//        → 422 con `camposFaltantes`, RESERVA intacta en 2v (sin mutación de estado,
//        ttl, FECHA_BLOQUEADA ni cola). Con datos completos → procede.
// ===========================================================================

describe('RegistrarResultadoVisita reserva_inmediata — validación de datos obligatorios UC-14 (3.2)', () => {
  it.each([
    ['dniNif', () => clienteCompleto({ dniNif: null })],
    ['direccion', () => clienteCompleto({ direccion: null })],
    ['codigoPostal', () => clienteCompleto({ codigoPostal: null })],
    ['poblacion', () => clienteCompleto({ poblacion: null })],
    ['provincia', () => clienteCompleto({ provincia: null })],
  ] as const)(
    'debe_bloquear_422_con_camposFaltantes_cuando_falta_el_dato_fiscal_del_cliente_%s_y_no_muta_nada',
    async (campo, cliente) => {
      const { useCase, repos } = montar({ cliente: cliente() });

      let error: unknown;
      await useCase.ejecutar(comando()).catch((e) => {
        error = e;
      });

      expect(error).toBeInstanceOf(DatosObligatoriosIncompletosError);
      // El `codigo` del envelope 422 debe alinearse al contrato congelado (schema
      // reutilizado de UC-14) y al branch del frontend: `DATOS_FISCALES_INCOMPLETOS`
      // (NO `DATOS_OBLIGATORIOS_INCOMPLETOS`), para que la rama datos-incompletos del
      // hook pinte la lista autoritativa de campos.
      expect((error as DatosObligatoriosIncompletosError).codigo).toBe(
        'DATOS_FISCALES_INCOMPLETOS',
      );
      expect(
        (error as DatosObligatoriosIncompletosError).camposFaltantes,
      ).toContain(campo);

      // RESERVA intacta: ni mutación, ni bloqueo, ni cola tocados.
      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.actualizarTtl).not.toHaveBeenCalled();
      expect(repos.cola.vaciar).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['fechaEvento', () => reservaOrigen({ fechaEvento: null })],
    ['duracionHoras', () => reservaOrigen({ duracionHoras: null })],
    ['tipoEvento', () => reservaOrigen({ tipoEvento: null })],
    ['numAdultosNinosMayores4', () => reservaOrigen({ numAdultosNinosMayores4: null })],
  ] as const)(
    'debe_bloquear_422_con_camposFaltantes_cuando_falta_el_dato_de_reserva_%s_y_no_muta_nada',
    async (campo, reserva) => {
      const { useCase, repos } = montar({ reserva: reserva() });

      let error: unknown;
      await useCase.ejecutar(comando()).catch((e) => {
        error = e;
      });

      expect(error).toBeInstanceOf(DatosObligatoriosIncompletosError);
      expect(
        (error as DatosObligatoriosIncompletosError).camposFaltantes,
      ).toContain(campo);
      expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    },
  );

  it('debe_enumerar_TODOS_los_campos_faltantes_cuando_faltan_varios', async () => {
    const { useCase } = montar({
      reserva: reservaOrigen({ tipoEvento: null, duracionHoras: null }),
      cliente: clienteCompleto({ dniNif: null, provincia: null }),
    });

    let error: unknown;
    await useCase.ejecutar(comando()).catch((e) => {
      error = e;
    });

    const faltantes = (error as DatosObligatoriosIncompletosError).camposFaltantes;
    expect(faltantes).toEqual(
      expect.arrayContaining(['dniNif', 'provincia', 'tipoEvento', 'duracionHoras']),
    );
  });

  it('debe_proceder_cuando_todos_los_datos_obligatorios_estan_completos', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.3 — Transición desde 2.v: → pre_reserva + subEstado=NULL + visita_realizada=true +
//        ttl = now + ttl_prereserva_dias (7d, leído del setting, NO ttl_consulta_dias) +
//        UPDATE del ttl de la fila existente de FECHA_BLOQUEADA al MISMO valor +
//        AUDIT_LOG transicion. Una sola tx. SIN email.
// ===========================================================================

describe('RegistrarResultadoVisita reserva_inmediata — transición 2.v → pre_reserva (3.3)', () => {
  it('debe_pasar_a_pre_reserva_subEstado_null_visita_realizada_true_y_ttl_de_7_dias', async () => {
    const { useCase, repos, uow } = montar({});

    const out = await useCase.ejecutar(comando());

    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    const argsRes = repos.reservas.actualizar.mock.calls[0][0];
    expect(argsRes.estado).toBe('pre_reserva');
    // pre_reserva no tiene sub-estado de consulta.
    expect(argsRes.subEstado ?? null).toBeNull();
    expect(argsRes.visitaRealizada).toBe(true);
    expect((argsRes.ttlExpiracion as Date).getTime()).toBe(
      ttlPrereservaEsperado(AHORA, TTL_PRERESERVA_DIAS),
    );

    expect(out.reserva.estado).toBe('pre_reserva');
    expect(out.reserva.subEstado ?? null).toBeNull();
    expect(out.reserva.visitaRealizada).toBe(true);

    // Una sola unidad de trabajo (1 transacción).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_usar_ttl_prereserva_dias_y_no_ttl_consulta_dias', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const nuevoTtl = (
      repos.reservas.actualizar.mock.calls[0][0].ttlExpiracion as Date
    ).getTime();
    // Debe ser now + 7 días (pre_reserva), NUNCA now + 3 días (consulta).
    expect(nuevoTtl).toBe(ttlPrereservaEsperado(AHORA, TTL_PRERESERVA_DIAS));
    expect(nuevoTtl).not.toBe(ttlPrereservaEsperado(AHORA, TTL_CONSULTA_DIAS));
  });

  it('no_debe_acumular_el_ttl_previo_ni_derivarlo_de_visita_programada_fecha', async () => {
    // TTL previo = 2026-07-02 (día post-visita); visita_programada_fecha = 2026-07-01.
    // El nuevo TTL debe ser now (2026-06-30) + 7 días, NO ttl_previo + 7, ni la fecha
    // de visita.
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const nuevoTtl = (
      repos.reservas.actualizar.mock.calls[0][0].ttlExpiracion as Date
    ).getTime();
    expect(nuevoTtl).toBe(ttlPrereservaEsperado(AHORA, TTL_PRERESERVA_DIAS));
    const ttlAcumulado =
      new Date('2026-07-02T23:59:59.000Z').getTime() + TTL_PRERESERVA_DIAS * DIA_MS;
    expect(nuevoTtl).not.toBe(ttlAcumulado);
    expect(nuevoTtl).not.toBe(new Date('2026-07-01T00:00:00.000Z').getTime());
  });

  it('debe_actualizar_el_ttl_de_la_fila_existente_de_FECHA_BLOQUEADA_al_mismo_valor', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    expect(repos.fechaBloqueada.actualizarTtl).toHaveBeenCalledTimes(1);
    const argsFb = repos.fechaBloqueada.actualizarTtl.mock.calls[0][0];
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      ttlPrereservaEsperado(AHORA, TTL_PRERESERVA_DIAS),
    );
    // El TTL escrito en RESERVA y en FECHA_BLOQUEADA es IDÉNTICO (única fuente de verdad).
    const argsRes = repos.reservas.actualizar.mock.calls[0][0];
    expect((argsFb.ttlExpiracion as Date).getTime()).toBe(
      (argsRes.ttlExpiracion as Date).getTime(),
    );
  });

  it('debe_mantener_tipo_bloqueo_blando_y_no_insertar_ni_eliminar_filas', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const argsFb = repos.fechaBloqueada.actualizarTtl.mock.calls[0][0];
    if ('tipoBloqueo' in argsFb) {
      expect(argsFb.tipoBloqueo).toBe('blando');
    }
    // La fila existente se bloquea con FOR UPDATE (UPDATE puro, no fila nueva).
    expect(repos.fechaBloqueada.leerBloqueoVigente).toHaveBeenCalledTimes(1);
  });

  it('debe_registrar_AUDIT_LOG_de_la_transicion_2v_a_pre_reserva_con_datos_antes_y_despues', async () => {
    const { useCase, repos } = montar({});

    await useCase.ejecutar(comando());

    const registro = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === RESERVA_ID,
    )?.[0];
    expect(registro).toBeDefined();
    expect(registro.accion).toBe('transicion');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.datosAnteriores?.subEstado).toBe('2v');
    expect(registro.datosNuevos?.estado).toBe('pre_reserva');
    expect(registro.datosNuevos?.subEstado ?? null).toBeNull();
    expect(registro.datosNuevos?.visitaRealizada).toBe(true);
  });

  it('debe_leer_ttl_prereserva_dias_de_TENANT_SETTINGS_y_no_hardcodearlo', async () => {
    const { useCase, tenantSettings } = montar({});
    await useCase.ejecutar(comando());
    expect(tenantSettings.obtener).toHaveBeenCalledWith(TENANT);
  });

  it('no_debe_disparar_ningun_email_E7_ni_E2_en_reserva_inmediata', async () => {
    // A diferencia de US-009 (interesado → E7), US-010 NO dispara email propio.
    const { useCase, confirmacionResultado } = montar({});

    await useCase.ejecutar(comando());

    expect(confirmacionResultado.enviar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Vaciado de cola A16 (D-5): con N consultas en 2d → todas a 2y en la misma tx +
//        AUDIT_LOG por cada consulta vaciada; con 0 consultas → operación vacía válida.
// ===========================================================================

describe('RegistrarResultadoVisita reserva_inmediata — vaciado de cola A16 (3.4)', () => {
  it('debe_vaciar_la_cola_apuntando_a_esta_reserva_en_la_misma_transaccion', async () => {
    const { useCase, repos } = montar({
      colaDescartadas: ['cola-1', 'cola-2', 'cola-3'],
    });

    await useCase.ejecutar(comando());

    expect(repos.cola.vaciar).toHaveBeenCalledTimes(1);
    const argsCola = repos.cola.vaciar.mock.calls[0][0];
    // La bloqueante es ESTA reserva (consulta_bloqueante_id = reservaId).
    expect(argsCola.consultaBloqueanteId).toBe(RESERVA_ID);
  });

  it('debe_registrar_un_AUDIT_LOG_por_cada_consulta_vaciada_ademas_de_la_principal', async () => {
    const { useCase, repos } = montar({
      colaDescartadas: ['cola-1', 'cola-2'],
    });

    await useCase.ejecutar(comando());

    // 1 (principal) + 2 (cola vaciada) = 3 registros de auditoría.
    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(3);

    const idsAuditados = repos.auditoria.registrar.mock.calls.map(
      (c) => c[0].entidadId,
    );
    expect(idsAuditados).toEqual(
      expect.arrayContaining([RESERVA_ID, 'cola-1', 'cola-2']),
    );

    // Cada entrada de cola audita el paso 2d → 2y.
    const auditCola1 = repos.auditoria.registrar.mock.calls.find(
      (c) => c[0].entidadId === 'cola-1',
    )?.[0];
    expect(auditCola1?.accion).toBe('transicion');
    expect(auditCola1?.datosAnteriores?.subEstado).toBe('2d');
    expect(auditCola1?.datosNuevos?.subEstado).toBe('2y');
  });

  it('debe_completar_la_transicion_sin_error_cuando_la_cola_esta_vacia_operacion_vacia', async () => {
    const { useCase, repos } = montar({ colaDescartadas: [] });

    const out = await useCase.ejecutar(comando());

    expect(out.reserva.estado).toBe('pre_reserva');
    expect(repos.cola.vaciar).toHaveBeenCalledTimes(1);
    // Solo la auditoría principal (0 consultas vaciadas).
    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.5 — Atomicidad: si una operación (RESERVA, FECHA_BLOQUEADA, cola o AUDIT_LOG) falla,
//        el error se propaga para que la UoW haga rollback total (no se atrapa).
// ===========================================================================

describe('RegistrarResultadoVisita reserva_inmediata — atomicidad / rollback (3.5)', () => {
  it.each(['actualizar', 'actualizarTtl', 'vaciar', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_la_operacion_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_SIMULADO_${op.toUpperCase()}`,
      );
    },
  );
});
