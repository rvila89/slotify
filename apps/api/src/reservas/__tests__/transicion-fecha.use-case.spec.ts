/**
 * TESTS del caso de uso `TransicionFechaUseCase` (US-005 / UC-04).
 * tasks.md Fase 3: 3.1 (guarda de origen a nivel de aplicación), 3.2 (2.a→2.b),
 * 3.3 (oferta de cola / 2.a→2.d con aceptarCola), 3.4 (no encolable), 3.6
 * (validación de fecha), 3.7 (borrador E1 dinámico SIN auto-envío).
 *
 * Trazabilidad: US-005 + change `email-transicion-fecha-borrador` (spec-delta
 * `consultas`, Requirements "Email de confirmación de bloqueo provisional…" MODIFIED
 * — borrador SIN envío; "Plantillas dinámicas de la transición de fecha"). El correo
 * E1 ya NO se auto-envía: ambas ramas (2.b y 2.d) crean un borrador dinámico en la
 * MISMA transacción, para revisión/envío manual del gestor (flujo US-046).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia D4 REALES
 * viven en `transicion-fecha-concurrencia.spec.ts` y `…-integracion.spec.ts`; aquí
 * se fija la ORQUESTACIÓN: guarda de origen, ramificación 2.b/2.d/permanece-2.a, qué
 * puerto se invoca en cada rama, el contrato del conflicto `colaDisponible` y la
 * creación del borrador E1 (sin envío) en 2.b/2.d.
 *
 * Contrato del endpoint congelado (POST /reservas/{id}/fecha):
 *   - 200 → RESERVA en 2.b / 2.d.
 *   - 409 → `AsignarFechaConflictoError { colaDisponible, motivo }`.
 *   - 400/422 → `TransicionFechaValidacionError` (fecha no válida o RESERVA no en 2a).
 *   - 404 → `ReservaNoEncontradaError` (RESERVA inexistente para el tenant).
 */
import {
  TransicionFechaUseCase,
  TransicionFechaValidacionError,
  AsignarFechaConflictoError,
  ReservaNoEncontradaError,
  type TransicionFechaComando,
  type TransicionFechaDeps,
  type RepositoriosTransicionFecha,
  type UnidadDeTrabajoTransicionPort,
  type ReservaTransicion,
  type EstadoFechaTransicion,
  type FechaBloqueadaTransicionRepositoryPort,
  type ClockPort,
} from '../application/transicion-fecha.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2a';
const CLIENTE_ID = 'cli-1';
const EMAIL_CLIENTE = 'marta.soler@example.com';
const FECHA = new Date('2027-09-12T00:00:00.000Z');
const AHORA = new Date('2026-06-28T10:00:00.000Z');
const HOY = new Date('2026-06-28T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

type ReservaRepoFake = {
  buscarPorId: jest.Mock;
  actualizar: jest.Mock;
};

type FechaBloqueadaFake = FechaBloqueadaTransicionRepositoryPort & {
  leerEstadoFecha: jest.Mock;
  bloquear: jest.Mock;
  siguientePosicionCola: jest.Mock;
};

interface ReposFake extends RepositoriosTransicionFecha {
  reservas: ReservaRepoFake;
  fechaBloqueada: FechaBloqueadaFake;
  comunicaciones: { crear: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

/** RESERVA semilla en su estado de origen (por defecto `consulta`/`2a`). */
const reservaOrigen = (over: Partial<ReservaTransicion> = {}): ReservaTransicion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2a',
  ttlExpiracion: null,
  fechaEvento: null,
  posicionCola: null,
  consultaBloqueanteId: null,
  clienteEmail: EMAIL_CLIENTE,
  clienteNombre: 'Marta',
  idioma: 'es',
  numInvitadosFinal: 40,
  duracionHoras: 8,
  ...over,
});

const crearReposFake = (
  estadoFecha: EstadoFechaTransicion,
  reserva: ReservaTransicion | null = reservaOrigen(),
): ReposFake => {
  const reservas: ReservaRepoFake = {
    buscarPorId: jest.fn(async () => reserva),
    actualizar: jest.fn(async (p: Record<string, unknown>) => ({
      ...reservaOrigen(),
      subEstado: p.subEstado,
      fechaEvento: (p.fechaEvento as Date | undefined) ?? FECHA,
      ttlExpiracion: (p.ttlExpiracion as Date | null) ?? null,
      posicionCola: (p.posicionCola as number | null | undefined) ?? null,
      consultaBloqueanteId:
        (p.consultaBloqueanteId as string | null | undefined) ?? null,
    })),
  };
  const fechaBloqueada: FechaBloqueadaFake = {
    leerEstadoFecha: jest.fn(async () => estadoFecha),
    bloquear: jest.fn(async () => undefined),
    siguientePosicionCola: jest.fn(async () => 1),
  };
  const comunicaciones = {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idComunicacion: 'com-1',
      tenantId: p.tenantId,
      reservaId: p.reservaId,
      clienteId: p.clienteId,
      codigoEmail: 'E1',
      estado: 'borrador',
      destinatarioEmail: p.destinatarioEmail,
      fechaEnvio: null,
    })),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  return { reservas, fechaBloqueada, comunicaciones, auditoria };
};

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoTransicionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosTransicionFecha) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const relojFijo: ClockPort = { ahora: () => AHORA };

const montar = (
  estadoFecha: EstadoFechaTransicion,
  opciones: {
    reserva?: ReservaTransicion | null;
  } = {},
) => {
  const repos = crearReposFake(
    estadoFecha,
    'reserva' in opciones ? (opciones.reserva ?? null) : reservaOrigen(),
  );
  const uow = crearUowFake(repos);
  const tenantSettings = {
    obtener: jest.fn(async () => ({ ttlConsultaDias: 3, ttlPrereservaDias: 3 })),
  };
  const deps: TransicionFechaDeps = {
    unidadDeTrabajo: uow,
    clock: relojFijo,
    tenantSettings,
  };
  return { useCase: new TransicionFechaUseCase(deps), repos, uow, tenantSettings };
};

const comando = (over: Partial<TransicionFechaComando> = {}): TransicionFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  fechaEvento: FECHA,
  ...over,
});

const LIBRE: EstadoFechaTransicion = { tipo: 'libre' };
const BLOQUEADA_POR_2B: EstadoFechaTransicion = {
  tipo: 'bloqueada',
  subEstadoBloqueante: '2b',
  estadoBloqueante: 'consulta',
  reservaBloqueanteId: 'res-bloqueante',
};
const BLOQUEADA_POR_PRE: EstadoFechaTransicion = {
  tipo: 'bloqueada',
  subEstadoBloqueante: null,
  estadoBloqueante: 'pre_reserva',
  reservaBloqueanteId: 'res-prereserva',
};

// ===========================================================================
// 3.1 — Guarda de origen: la RESERVA debe estar en 2.a (sin efectos si no).
// ===========================================================================

describe('TransicionFechaUseCase — guarda de origen 2.a (3.1)', () => {
  it('debe_rechazar_con_validacion_y_sin_mutar_cuando_la_reserva_esta_en_2b', async () => {
    const { useCase, repos } = montar(LIBRE, {
      reserva: reservaOrigen({ subEstado: '2b' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      TransicionFechaValidacionError,
    );

    // No hay mutación de la RESERVA ni bloqueo: permanece como estaba.
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_validacion_cuando_la_reserva_esta_en_un_estado_terminal', async () => {
    const { useCase, repos } = montar(LIBRE, {
      reserva: reservaOrigen({ subEstado: '2x' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      TransicionFechaValidacionError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    // RLS / multi-tenancy: una RESERVA de otro tenant es invisible → 404.
    const { useCase, repos } = montar(LIBRE, { reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 — Fecha libre → RESERVA 2.a→2.b + bloqueo blando + AUDIT_LOG, en 1 sola tx.
// ===========================================================================

describe('TransicionFechaUseCase — fecha libre transiciona a 2.b y bloquea (3.2)', () => {
  it('debe_actualizar_la_reserva_a_2b_con_fecha_y_ttl_no_nulo', async () => {
    const { useCase, repos } = montar(LIBRE);

    const out = await useCase.ejecutar(comando());

    expect(repos.reservas.actualizar).toHaveBeenCalledTimes(1);
    const args = repos.reservas.actualizar.mock.calls[0][0];
    expect(args.subEstado).toBe('2b');
    expect(args.fechaEvento).toEqual(FECHA);
    expect(args.ttlExpiracion).toBeInstanceOf(Date);
    expect(out.reserva.subEstado).toBe('2b');
  });

  it('debe_insertar_FECHA_BLOQUEADA_blando_para_la_misma_reserva_dentro_de_la_unidad_de_trabajo', async () => {
    const { useCase, repos, uow } = montar(LIBRE);

    await useCase.ejecutar(comando());

    expect(repos.fechaBloqueada.bloquear).toHaveBeenCalledTimes(1);
    const args = repos.fechaBloqueada.bloquear.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.fecha).toEqual(FECHA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.ttlExpiracion).toBeInstanceOf(Date);
    // Toda la escritura ocurre DENTRO de una única unidad de trabajo (1 sola tx).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_derivar_el_ttl_de_TENANT_SETTINGS_y_no_hardcodearlo', async () => {
    const { useCase, repos, tenantSettings } = montar(LIBRE);

    await useCase.ejecutar(comando());

    expect(tenantSettings.obtener).toHaveBeenCalledWith(TENANT);
    const ttl = repos.fechaBloqueada.bloquear.mock.calls[0][0].ttlExpiracion as Date;
    // ttl = now() + ttl_consulta_dias (3): estrictamente futuro respecto a `ahora`.
    expect(ttl.getTime()).toBeGreaterThan(AHORA.getTime());
  });

  it('debe_registrar_AUDIT_LOG_de_la_transicion_2a_a_2b', async () => {
    const { useCase, repos } = montar(LIBRE);

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const registro = repos.auditoria.registrar.mock.calls[0][0];
    expect(registro.accion).toBe('transicion');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.entidadId).toBe(RESERVA_ID);
    expect(registro.datosAnteriores?.subEstado).toBe('2a');
    expect(registro.datosNuevos?.subEstado).toBe('2b');
    expect(registro.datosNuevos?.fechaEvento).toEqual(FECHA);
  });

  it('no_debe_asignar_posicion_de_cola_cuando_la_fecha_esta_libre', async () => {
    const { useCase, repos } = montar(LIBRE);

    await useCase.ejecutar(comando());

    expect(repos.fechaBloqueada.siguientePosicionCola).not.toHaveBeenCalled();
    const args = repos.reservas.actualizar.mock.calls[0][0];
    expect(args.posicionCola ?? null).toBeNull();
    expect(args.consultaBloqueanteId ?? null).toBeNull();
  });
});

// ===========================================================================
// 3.3 — Fecha bloqueada por 2.b: oferta de cola interactiva (FA-01).
//        sin aceptarCola → 409 colaDisponible:true, permanece 2.a, SIN efectos.
//        con aceptarCola=true → 2.d con posicion_cola + consulta_bloqueante_id.
// ===========================================================================

describe('TransicionFechaUseCase — bloqueada por 2.b ofrece/entra en cola (3.3)', () => {
  it('debe_ofrecer_cola_409_colaDisponible_true_y_no_mutar_cuando_no_se_acepta', async () => {
    const { useCase, repos } = montar(BLOQUEADA_POR_2B);

    const error = await useCase.ejecutar(comando()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AsignarFechaConflictoError);
    expect((error as AsignarFechaConflictoError).colaDisponible).toBe(true);
    expect((error as AsignarFechaConflictoError).motivo).toBeTruthy();
    // La RESERVA permanece en 2.a: ni mutación, ni bloqueo, ni cola, ni borrador.
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.siguientePosicionCola).not.toHaveBeenCalled();
    expect(repos.comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_transicionar_a_2d_con_posicion_y_bloqueante_cuando_se_acepta_la_cola', async () => {
    const { useCase, repos } = montar(BLOQUEADA_POR_2B);
    repos.fechaBloqueada.siguientePosicionCola.mockResolvedValueOnce(3);

    const out = await useCase.ejecutar(comando({ aceptarCola: true }));

    const args = repos.reservas.actualizar.mock.calls[0][0];
    expect(args.subEstado).toBe('2d');
    expect(args.posicionCola).toBe(3);
    expect(args.consultaBloqueanteId).toBe('res-bloqueante');
    expect(out.reserva.subEstado).toBe('2d');
    // No se inserta una segunda FECHA_BLOQUEADA: la fecha ya la bloquea la 2.b.
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.siguientePosicionCola).toHaveBeenCalledTimes(1);
  });

  it('debe_crear_un_borrador_E1_cola_sin_envio_en_la_entrada_a_cola_2d', async () => {
    const { useCase, repos } = montar(BLOQUEADA_POR_2B);

    await useCase.ejecutar(comando({ aceptarCola: true }));

    // La rama 2.d TAMBIÉN crea su borrador E1 (plantilla "cola"), en `borrador` y
    // sin envío (fecha_envio = null): revisión/envío manual del gestor (US-046).
    expect(repos.comunicaciones.crear).toHaveBeenCalledTimes(1);
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E1');
    expect(args.estado).toBe('borrador');
    expect(args.fechaEnvio).toBeNull();
    // Idioma por defecto de la semilla ('es') → frase clave de la plantilla "cola".
    expect(args.cuerpo).toContain('bloqueada por otra consulta');
  });
});

// ===========================================================================
// 3.4 — Fecha bloqueada por estado no encolable (2.c/2.v/pre+) → sin cola (FA-02).
//        409 colaDisponible:false, permanece 2.a, incluso con aceptarCola=true.
// ===========================================================================

describe('TransicionFechaUseCase — bloqueada por estado no encolable, sin cola (3.4)', () => {
  it('debe_rechazar_409_colaDisponible_false_y_no_mutar_la_reserva', async () => {
    const { useCase, repos } = montar(BLOQUEADA_POR_PRE);

    const error = await useCase.ejecutar(comando()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AsignarFechaConflictoError);
    expect((error as AsignarFechaConflictoError).colaDisponible).toBe(false);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
  });

  it('debe_seguir_sin_ofrecer_cola_aunque_se_envie_aceptarCola_true', async () => {
    const { useCase, repos } = montar(BLOQUEADA_POR_PRE);

    const error = await useCase
      .ejecutar(comando({ aceptarCola: true }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AsignarFechaConflictoError);
    expect((error as AsignarFechaConflictoError).colaDisponible).toBe(false);
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.siguientePosicionCola).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.6 — Validación de fecha en servidor (D-1: estrictamente futura `> hoy`).
//        hoy y pasado → rechazo SIN abrir la transacción (sin efectos).
// ===========================================================================

describe('TransicionFechaUseCase — validación de fecha `> hoy` (3.6)', () => {
  it('debe_rechazar_fecha_igual_a_hoy_sin_abrir_la_transaccion', async () => {
    const { useCase, uow, repos } = montar(LIBRE);

    await expect(
      useCase.ejecutar(comando({ fechaEvento: HOY })),
    ).rejects.toBeInstanceOf(TransicionFechaValidacionError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(repos.reservas.actualizar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_fecha_pasada_sin_abrir_la_transaccion', async () => {
    const { useCase, uow } = montar(LIBRE);

    await expect(
      useCase.ejecutar(comando({ fechaEvento: new Date('2020-01-01T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(TransicionFechaValidacionError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — Borrador E1 dinámico de la transición (change email-transicion-fecha-borrador).
//        Tras 2.a→2.b se crea la COMUNICACION E1 en `borrador` con la plantilla
//        "disponible" renderizada; NO se auto-envía (fecha_envio = null, sin motor).
// ===========================================================================

describe('TransicionFechaUseCase — borrador E1 "disponible" sin envío (3.7)', () => {
  it('debe_crear_la_COMUNICACION_E1_en_borrador_con_la_plantilla_disponible_y_sin_envio', async () => {
    const { useCase, repos } = montar(LIBRE);

    await useCase.ejecutar(comando());

    expect(repos.comunicaciones.crear).toHaveBeenCalledTimes(1);
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.codigoEmail).toBe('E1');
    expect(args.estado).toBe('borrador');
    expect(args.fechaEnvio).toBeNull();
    expect(args.destinatarioEmail).toBe(EMAIL_CLIENTE);
    // Texto dinámico de la plantilla "disponible" (idioma 'es' de la semilla).
    expect(args.asunto?.trim().length ?? 0).toBeGreaterThan(0);
    expect(args.cuerpo).toContain('disponible');
    expect(args.cuerpo).toContain("Ari — Masia l'Encís");
  });

  it('debe_interpolar_personas_y_horas_reales_de_la_reserva_en_el_borrador', async () => {
    const { useCase, repos } = montar(LIBRE, {
      reserva: reservaOrigen({ numInvitadosFinal: 30, duracionHoras: 6 }),
    });

    await useCase.ejecutar(comando());

    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.cuerpo).toContain('30 personas');
    expect(args.cuerpo).toContain('6 horas');
  });

  it('debe_usar_placeholder_cuando_faltan_personas_u_horas_en_la_reserva', async () => {
    const { useCase, repos } = montar(LIBRE, {
      reserva: reservaOrigen({ numInvitadosFinal: null, duracionHoras: null }),
    });

    await useCase.ejecutar(comando());

    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.cuerpo).toContain('___ personas');
    expect(args.cuerpo).toContain('___ horas');
  });
});
