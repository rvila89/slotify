/**
 * TESTS del caso de uso `AltaConsultaUseCase` en su RAMA CON FECHA (US-004 / UC-03)
 * — fase TDD RED. tasks.md Fase 3: 3.2, 3.3, 3.4, 3.7.
 *
 * Trazabilidad: US-004, spec-delta `consultas` (Requirements: "Alta con fecha
 * disponible crea una RESERVA en 2.b con bloqueo blando atómico", "Alta sobre
 * fecha bloqueada por una consulta en 2.b entra en cola (2.d)", "Alta sobre fecha
 * bloqueada por estados no encolables va a 2.a exploratoria", "Respuesta inicial
 * automática E1 según el campo comentarios" [MODIFIED: tarifa estimada]),
 * design.md §D-1 (mismo endpoint, branch interno), §D-2 (INSERT FECHA_BLOQUEADA
 * en la MISMA transacción del alta), §D-3 (determinación declarativa del
 * sub-estado dentro del cuerpo transaccional), §D-4 (puerto de tarifa TOLERANTE a
 * faltas/errores), §D-5 (cola serializada).
 *
 * Ejercita el caso de uso de APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory),
 * sin tocar Prisma (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la
 * concurrencia D4 REALES se verifican contra la BD en
 * `alta-consulta-con-fecha-concurrencia.spec.ts`; aquí se fija la ORQUESTACIÓN: la
 * ramificación 2.b/2.d/2.a, qué puerto se invoca en cada rama y la TOLERANCIA del
 * motor de tarifa.
 *
 * RED: aún NO existen en `application/alta-consulta.use-case.ts`:
 *   - el campo `fechaEvento` del comando,
 *   - el repo tx-bound `fechaBloqueada` (`FechaBloqueadaAltaRepositoryPort`:
 *     `leerEstadoFecha` / `bloquear` / `siguientePosicionCola`) dentro de
 *     `RepositoriosAltaConsulta`,
 *   - el puerto `TarifaEstimadaPort` en `AltaConsultaDeps`,
 *   - los campos `subEstado('2a'|'2b'|'2d')` / `posicionCola` /
 *     `consultaBloqueanteId` / `tarifaEstimada` / `fechaDisponible` /
 *     `avisoDisponibilidad` del resultado.
 * Los imports/uso de estos símbolos fallan en compilación y la batería está en
 * ROJO. GREEN es responsabilidad de `backend-developer`.
 */
import {
  AltaConsultaUseCase,
  AltaConsultaValidacionError,
  type AltaConsultaComando,
  type AltaConsultaDeps,
  type RepositoriosAltaConsulta,
  type UnidadDeTrabajoPort,
  type ClockPort,
  type EstadoFechaAlta,
  type FechaBloqueadaAltaRepositoryPort,
  type TarifaEstimadaPort,
  type FinalizarEnvioEmailPort,
} from '../application/alta-consulta.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL = 'marta.soler@example.com';
const FECHA = new Date('2027-09-12T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

type FechaBloqueadaFake = FechaBloqueadaAltaRepositoryPort & {
  leerEstadoFecha: jest.Mock;
  bloquear: jest.Mock;
  siguientePosicionCola: jest.Mock;
};

interface ReposFake extends RepositoriosAltaConsulta {
  clientes: { buscarPorEmail: jest.Mock; crear: jest.Mock };
  reservas: { crear: jest.Mock };
  comunicaciones: { crear: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
  fechaBloqueada: FechaBloqueadaFake;
}

/** Repos fake. `estadoFecha` controla la rama (libre / bloqueada por X). */
const crearReposFake = (estadoFecha: EstadoFechaAlta): ReposFake => {
  const clientes = {
    buscarPorEmail: jest.fn(async () => null),
    crear: jest.fn(async (p: { tenantId: string; email: string }) => ({
      idCliente: 'cli-nuevo',
      tenantId: p.tenantId,
      nombre: 'Marta',
      apellidos: 'Soler',
      email: p.email,
      telefono: '600111222',
    })),
  };
  const reservas = {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idReserva: 'res-1',
      tenantId: p.tenantId,
      clienteId: p.clienteId,
      codigo: '27-0001',
      estado: 'consulta',
      subEstado: p.subEstado,
      ttlExpiracion: (p.ttlExpiracion as Date | null) ?? null,
      canalEntrada: p.canalEntrada,
    })),
  };
  const comunicaciones = {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idComunicacion: 'com-1',
      tenantId: p.tenantId,
      reservaId: p.reservaId,
      clienteId: p.clienteId,
      codigoEmail: 'E1',
      estado: p.estado,
      destinatarioEmail: p.destinatarioEmail,
      fechaEnvio: (p.fechaEnvio as Date | null) ?? null,
    })),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const fechaBloqueada: FechaBloqueadaFake = {
    leerEstadoFecha: jest.fn(async () => estadoFecha),
    bloquear: jest.fn(async () => undefined),
    siguientePosicionCola: jest.fn(async () => 1),
  };
  return { clientes, reservas, comunicaciones, auditoria, fechaBloqueada };
};

const crearUowFake = (repos: ReposFake): UnidadDeTrabajoPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosAltaConsulta) => Promise<T>) =>
      trabajo(repos),
  ),
});

const crearFinalizarFake = (): FinalizarEnvioEmailPort & { finalizarEnvio: jest.Mock } => ({
  finalizarEnvio: jest.fn(async () => ({
    estado: 'enviado' as const,
    fechaEnvio: new Date('2026-06-28T10:00:00.000Z'),
  })),
});

/** Puerto de tarifa tolerante: por defecto devuelve un cálculo con precio. */
const crearTarifaFake = (
  impl?: () => Promise<unknown>,
): TarifaEstimadaPort & { estimar: jest.Mock } => ({
  estimar: jest.fn(
    impl ??
      (async () => ({ totalEur: 9500, precioTarifaEur: 9500, tarifaAConsultar: false })),
  ),
});

const relojFijo: ClockPort = { ahora: () => new Date('2026-06-28T10:00:00.000Z') };

const montar = (
  estadoFecha: EstadoFechaAlta,
  tarifa = crearTarifaFake(),
) => {
  const repos = crearReposFake(estadoFecha);
  const uow = crearUowFake(repos);
  const finalizarEnvio = crearFinalizarFake();
  const deps: AltaConsultaDeps = {
    unidadDeTrabajo: uow,
    finalizarEnvio,
    clock: relojFijo,
    tarifaEstimada: tarifa,
  };
  return { useCase: new AltaConsultaUseCase(deps), repos, uow, finalizarEnvio, tarifa };
};

const comandoConFecha = (
  over: Partial<AltaConsultaComando> = {},
): AltaConsultaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  canalEntrada: 'web',
  fechaEvento: FECHA,
  cliente: { nombre: 'Marta', apellidos: 'Soler', email: EMAIL, telefono: '600111222' },
  ...over,
});

// ===========================================================================
// 3.2 — Alta con fecha LIBRE → RESERVA 2.b + bloqueo blando en la misma tx.
// ===========================================================================

describe('AltaConsultaUseCase (con fecha) — fecha libre crea 2.b y bloquea (3.2)', () => {
  it('debe_crear_la_reserva_en_2b_cuando_la_fecha_esta_libre', async () => {
    const { useCase, repos } = montar({ tipo: 'libre' });

    const out = await useCase.ejecutar(comandoConFecha());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.subEstado).toBe('2b');
    expect(args.fechaEvento).toEqual(FECHA);
    expect(out.reserva.subEstado).toBe('2b');
  });

  it('debe_insertar_FECHA_BLOQUEADA_blando_para_la_misma_reserva_dentro_de_la_unidad_de_trabajo', async () => {
    const { useCase, repos, uow } = montar({ tipo: 'libre' });

    await useCase.ejecutar(comandoConFecha());

    expect(repos.fechaBloqueada.bloquear).toHaveBeenCalledTimes(1);
    const args = repos.fechaBloqueada.bloquear.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.fecha).toEqual(FECHA);
    expect(args.reservaId).toBe('res-1');
    // El bloqueo blando viaja con un TTL (Date) coherente con el de la reserva.
    expect(args.ttlExpiracion).toBeInstanceOf(Date);
    // Toda la escritura ocurre DENTRO de la misma unidad de trabajo (1 sola tx).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_fijar_un_ttl_expiracion_no_nulo_en_la_reserva_2b', async () => {
    const { useCase, repos } = montar({ tipo: 'libre' });

    await useCase.ejecutar(comandoConFecha());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.ttlExpiracion).toBeInstanceOf(Date);
  });

  it('no_debe_asignar_cola_cuando_la_fecha_esta_libre', async () => {
    const { useCase, repos } = montar({ tipo: 'libre' });

    await useCase.ejecutar(comandoConFecha());

    expect(repos.fechaBloqueada.siguientePosicionCola).not.toHaveBeenCalled();
    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.posicionCola ?? null).toBeNull();
    expect(args.consultaBloqueanteId ?? null).toBeNull();
  });
});

// ===========================================================================
// 3.3 — Alta sobre fecha bloqueada por 2.b → RESERVA 2.d en cola, sin bloqueo.
// ===========================================================================

describe('AltaConsultaUseCase (con fecha) — bloqueada por 2.b entra en cola 2.d (3.3)', () => {
  const estadoBloqueadaPor2b: EstadoFechaAlta = {
    tipo: 'bloqueada',
    subEstadoBloqueante: '2b',
    estadoBloqueante: 'consulta',
    reservaBloqueanteId: 'res-bloqueante',
  };

  it('debe_crear_la_reserva_en_2d_con_posicion_cola_y_consulta_bloqueante', async () => {
    const { useCase, repos } = montar(estadoBloqueadaPor2b);
    repos.fechaBloqueada.siguientePosicionCola.mockResolvedValueOnce(3);

    const out = await useCase.ejecutar(comandoConFecha());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.subEstado).toBe('2d');
    expect(args.posicionCola).toBe(3);
    expect(args.consultaBloqueanteId).toBe('res-bloqueante');
    expect(out.reserva.subEstado).toBe('2d');
  });

  it('no_debe_insertar_una_nueva_FECHA_BLOQUEADA_para_la_consulta_en_cola', async () => {
    const { useCase, repos } = montar(estadoBloqueadaPor2b);

    await useCase.ejecutar(comandoConFecha());

    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.siguientePosicionCola).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.4 — Alta sobre fecha bloqueada por estado superior → 2.a exploratoria.
// ===========================================================================

describe('AltaConsultaUseCase (con fecha) — bloqueada por estado superior va a 2.a (3.4)', () => {
  const estadoBloqueadaPorPreReserva: EstadoFechaAlta = {
    tipo: 'bloqueada',
    subEstadoBloqueante: null,
    estadoBloqueante: 'pre_reserva',
    reservaBloqueanteId: 'res-prereserva',
  };

  it('debe_crear_la_reserva_en_2a_sin_bloqueo_ni_cola', async () => {
    const { useCase, repos } = montar(estadoBloqueadaPorPreReserva);

    const out = await useCase.ejecutar(comandoConFecha());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.subEstado).toBe('2a');
    expect(args.posicionCola ?? null).toBeNull();
    expect(args.consultaBloqueanteId ?? null).toBeNull();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.siguientePosicionCola).not.toHaveBeenCalled();
    expect(out.reserva.subEstado).toBe('2a');
  });

  it('debe_informar_de_que_la_fecha_no_esta_disponible_en_el_resultado', async () => {
    const { useCase } = montar(estadoBloqueadaPorPreReserva);

    const out = await useCase.ejecutar(comandoConFecha());

    expect(out.fechaDisponible).toBe(false);
    expect(out.avisoDisponibilidad).toBeTruthy();
  });
});

// ===========================================================================
// 3.7 (item 9) — Tarifa estimada en E1, TOLERANTE a faltas y errores (D-4).
// ===========================================================================

describe('AltaConsultaUseCase (con fecha) — tarifa estimada en E1 tolerante (3.7)', () => {
  it('debe_calcular_la_tarifa_e_incluirla_en_el_resultado_cuando_hay_fecha_invitados_y_horas', async () => {
    const tarifa = crearTarifaFake();
    const { useCase, repos } = montar({ tipo: 'libre' }, tarifa);

    const out = await useCase.ejecutar(
      comandoConFecha({ duracionHoras: 8, numAdultosNinosMayores4: 80 }),
    );

    expect(tarifa.estimar).toHaveBeenCalledTimes(1);
    expect(tarifa.estimar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        fechaEvento: FECHA,
        duracionHoras: 8,
        numAdultosNinosMayores4: 80,
      }),
    );
    expect(out.tarifaEstimada).not.toBeNull();
    // E1 se sigue creando (auto-envío sin comentarios).
    expect(repos.comunicaciones.crear.mock.calls[0][0].codigoEmail).toBe('E1');
  });

  it('no_debe_llamar_al_motor_de_tarifa_si_faltan_invitados_u_horas_y_E1_va_sin_precio', async () => {
    const tarifa = crearTarifaFake();
    const { useCase } = montar({ tipo: 'libre' }, tarifa);

    // Falta numAdultosNinosMayores4 y duracionHoras → dossier general sin precio.
    const out = await useCase.ejecutar(comandoConFecha());

    expect(tarifa.estimar).not.toHaveBeenCalled();
    expect(out.tarifaEstimada).toBeNull();
  });

  it('no_debe_bloquear_el_alta_si_el_motor_de_tarifa_lanza_un_error', async () => {
    // El motor puede lanzar TEMPORADA_NO_CONFIGURADA / TARIFA_NO_CONFIGURADA: la
    // tarifa es DECORATIVA de E1, nunca un bloqueante (D-4). El alta (RESERVA 2.b +
    // bloqueo) ya está comprometida; E1 sale sin precio.
    const tarifa = crearTarifaFake(async () => {
      throw new Error('TARIFA_NO_CONFIGURADA');
    });
    const { useCase, repos } = montar({ tipo: 'libre' }, tarifa);

    const out = await useCase.ejecutar(
      comandoConFecha({ duracionHoras: 8, numAdultosNinosMayores4: 80 }),
    );

    // El alta NO se rechaza: la reserva 2.b y su bloqueo se crean igualmente.
    expect(out.reserva.subEstado).toBe('2b');
    expect(repos.fechaBloqueada.bloquear).toHaveBeenCalledTimes(1);
    // Pero E1 va sin precio (tarifa degradada a null).
    expect(out.tarifaEstimada).toBeNull();
  });
});

// ===========================================================================
// 3.6 (item 10) — Campos obligatorios incompletos → 400 sin efectos.
// ===========================================================================

describe('AltaConsultaUseCase (con fecha) — validación de campos (3.6 / item 10)', () => {
  it('debe_rechazar_con_validacion_y_sin_abrir_la_transaccion_si_falta_el_nombre', async () => {
    const { useCase, uow } = montar({ tipo: 'libre' });

    await expect(
      useCase.ejecutar(comandoConFecha({ cliente: { nombre: '', apellidos: 'Soler', email: EMAIL, telefono: '600111222' } })),
    ).rejects.toBeInstanceOf(AltaConsultaValidacionError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
  });
});
