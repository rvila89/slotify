/**
 * TESTS del caso de uso `CambiarFechaUseCase` — RAMA NUEVA de ORIGEN `2d` (cola de espera)
 * del change `cambiar-fecha-consulta-en-cola` — fase TDD RED. tasks.md §"TDD primero"
 * (aplicación rama 2d fecha libre + fecha ocupada).
 *
 * Trazabilidad: proposal §"What Changes" (dos decisiones de producto); design.md §D-1..D-6;
 * spec-delta `consultas` (Requirement "Cambio atómico de una fecha ya bloqueada", escenarios
 * "Cambiar una consulta en cola (2d) a una fecha libre la saca de la cola y pasa a 2.b" y
 * "Cambiar una consulta en cola (2d) a una fecha ocupada aborta con conflicto (409) sin
 * efectos"). CLAUDE.md §Regla crítica: bloqueo atómico de fecha; §Máquina de estados.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD/concurrencia REALES viven en
 * `cambiar-fecha-en-cola-concurrencia.spec.ts` (Postgres real). Aquí se fija la ORQUESTACIÓN
 * de la rama `2d`:
 *   Fecha nueva LIBRE (en UNA transacción):
 *     - INSERTA bloqueo blando de F2 con TTL (primitiva existente `bloquear`);
 *     - `RESERVA.fecha_evento = F2`, `sub_estado 2d → 2b`, `posicion_cola → NULL`,
 *       `consulta_bloqueante_id → NULL` (salida de cola);
 *     - REORDENA la cola vieja (decremento contiguo desde 1, hermanos con mismo bloqueante);
 *     - crea un BORRADOR E1 `'disponible'` (`fecha_envio = NULL`, no autoenviado);
 *     - AUDIT_LOG `accion='actualizar'`, `entidad='RESERVA'`;
 *     - NO promueve NINGUNA cola; NO toca la RESERVA bloqueante ni su FECHA_BLOQUEADA.
 *   Fecha nueva OCUPADA:
 *     - `CambiarFechaConflictoError` (409) TERMINAL, shape solo `motivo` (sin `colaDisponible`);
 *     - rollback total: la RESERVA conserva `2d`, `posicion_cola`, `consulta_bloqueante_id`;
 *       cola intacta.
 *
 * RED: la rama `2d` aún NO existe en `cambiar-fecha.use-case.ts`. Hoy la guarda
 * `esOrigenValidoParaCambiarFecha` rechaza `2d` con 422, por lo que estos tests están en
 * ROJO (el use-case lanza `CambiarFechaValidacionError` en vez de ejecutar la rama cola, o
 * los puertos nuevos no se invocan). GREEN es de `backend-developer`.
 */
import {
  CambiarFechaUseCase,
  CambiarFechaConflictoError,
  CambiarFechaValidacionError,
  type CambiarFechaComando,
  type CambiarFechaDeps,
  type ReservaCambioFecha,
  type EstadoFechaDestino,
  type RepositoriosCambiarFecha,
  type UnidadDeTrabajoCambiarFechaPort,
  type ClockPort,
} from '../application/cambiar-fecha.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2d';
const BLOQUEANTE_ID = 'res-bloqueante-B';
const F1 = new Date('2027-09-12T00:00:00.000Z'); // fecha antigua de la cola (bloqueada por B)
const F2 = new Date('2027-10-20T00:00:00.000Z'); // fecha nueva
const AHORA = new Date('2026-06-28T10:00:00.000Z');
const P = 2; // posición de la RESERVA en la cola vieja

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). Se declaran TODOS los seams que la rama `2d`
// necesita; el use-case debe orquestarlos. Métodos nuevos (salida de cola +
// reordenación + borrador E1) además de los existentes de la rama 2b/2c/2v.
// ---------------------------------------------------------------------------

type ReservaRepoFake = {
  buscarPorId: jest.Mock;
  actualizarFecha: jest.Mock;
  /** NUEVO (rama 2d): saca la RESERVA de la cola y la pasa a 2b con nueva fecha. */
  moverFueraDeCola: jest.Mock;
  /** NUEVO (rama 2d): lee los hermanos de cola (mismo bloqueante) para reordenar. */
  leerColaHermana: jest.Mock;
  /** NUEVO (rama 2d): aplica los decrementos de posición de la cola vieja. */
  reordenarCola: jest.Mock;
};

type FechaBloqueadaFake = {
  leerEstadoFecha: jest.Mock;
  bloquear: jest.Mock;
  liberar: jest.Mock;
  tieneCola: jest.Mock;
};

type ComunicacionesFake = {
  /** NUEVO (rama 2d): crea el borrador E1 'disponible' (fecha_envio null). */
  crearBorradorE1: jest.Mock;
};

interface ReposFake extends RepositoriosCambiarFecha {
  reservas: ReservaRepoFake;
  fechaBloqueada: FechaBloqueadaFake;
  promocionCola: { promoverPrimeroEnCola: jest.Mock };
  comunicaciones: ComunicacionesFake;
  auditoria: { registrar: jest.Mock };
}

/** RESERVA semilla en `consulta`/`2d` con posición P y bloqueante B, fecha antigua F1. */
const reservaEnCola = (over: Partial<ReservaCambioFecha> = {}): ReservaCambioFecha =>
  ({
    idReserva: RESERVA_ID,
    tenantId: TENANT,
    estado: 'consulta',
    subEstado: '2d',
    fechaEvento: F1,
    posicionCola: P,
    consultaBloqueanteId: BLOQUEANTE_ID,
    ...over,
  }) as ReservaCambioFecha;

/** Cola vieja hermana (mismo bloqueante): R2(1) R_esta(2) R4(3). */
const colaHermana = () => [
  { reservaId: 'R2', subEstado: '2d', posicionCola: 1, consultaBloqueanteId: BLOQUEANTE_ID },
  { reservaId: RESERVA_ID, subEstado: '2d', posicionCola: 2, consultaBloqueanteId: BLOQUEANTE_ID },
  { reservaId: 'R4', subEstado: '2d', posicionCola: 3, consultaBloqueanteId: BLOQUEANTE_ID },
];

const crearReposFake = (opciones: {
  estadoFechaDestino: EstadoFechaDestino;
  reserva?: ReservaCambioFecha | null;
}): ReposFake => {
  const reserva =
    opciones.reserva === undefined ? reservaEnCola() : opciones.reserva;
  // Fake CON ESTADO: reproduce el orden real de operaciones. `moverFueraDeCola` saca la
  // RESERVA de la cola (pone su `consulta_bloqueante_id → NULL`), así que un
  // `leerColaHermana` POSTERIOR ya NO la vería. `planificarSalidaDeCola` exige que la
  // saliente SIGA en la cola; si el use-case leyera la cola DESPUÉS de mover, el fake
  // devolvería una cola sin la saliente (no contigua) → anomalía → sin reordenación. Este
  // estado hace que el test falle si se regresa a ese orden (bug detectado en QA real).
  let salienteFueraDeCola = false;
  const reservas: ReservaRepoFake = {
    buscarPorId: jest.fn(async () => reserva),
    actualizarFecha: jest.fn(async () => reserva),
    moverFueraDeCola: jest.fn(async (p: { idReserva: string; fechaEvento: Date }) => {
      salienteFueraDeCola = true;
      return {
        ...(reserva ?? reservaEnCola()),
        fechaEvento: p.fechaEvento,
        subEstado: '2b',
        posicionCola: null,
        consultaBloqueanteId: null,
      };
    }),
    leerColaHermana: jest.fn(async () =>
      colaHermana().filter((e) => !(salienteFueraDeCola && e.reservaId === RESERVA_ID)),
    ),
    reordenarCola: jest.fn(async () => undefined),
  };
  const fechaBloqueada: FechaBloqueadaFake = {
    leerEstadoFecha: jest.fn(async () => opciones.estadoFechaDestino),
    bloquear: jest.fn(async () => undefined),
    liberar: jest.fn(async () => undefined),
    tieneCola: jest.fn(async () => false),
  };
  const promocionCola = { promoverPrimeroEnCola: jest.fn(async () => undefined) };
  const comunicaciones: ComunicacionesFake = {
    crearBorradorE1: jest.fn(async () => undefined),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  return {
    reservas,
    fechaBloqueada,
    promocionCola,
    comunicaciones,
    auditoria,
  } as unknown as ReposFake;
};

const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoCambiarFechaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosCambiarFecha) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

interface Escenario {
  deps: CambiarFechaDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
}

const construir = (opciones: {
  estadoFechaDestino?: EstadoFechaDestino;
  reserva?: ReservaCambioFecha | null;
}): Escenario => {
  const repos = crearReposFake({
    estadoFechaDestino: opciones.estadoFechaDestino ?? { tipo: 'libre' },
    reserva: opciones.reserva,
  });
  const uow = crearUoWFake(repos);
  const clock: ClockPort = { ahora: () => AHORA };
  const deps: CambiarFechaDeps = { unidadDeTrabajo: uow, clock };
  return { deps, repos, uow };
};

const comando = (over: Partial<CambiarFechaComando> = {}): CambiarFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  fechaEvento: F2,
  ...over,
});

// ===========================================================================
// 1. Rama 2d, fecha LIBRE — efectos completos en UNA transacción.
// ===========================================================================

describe('CambiarFecha rama 2d — fecha libre: sale de la cola y pasa a 2b (escenario cola)', () => {
  it('debe_ejecutar_todo_dentro_de_una_unica_unidad_de_trabajo_bajo_el_tenant', async () => {
    const { deps, uow } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });

  it('debe_INSERTAR_el_bloqueo_blando_de_F2_para_esta_reserva', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(repos.fechaBloqueada.bloquear).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: F2, reservaId: RESERVA_ID }),
    );
  });

  it('debe_sacar_la_reserva_de_la_cola_a_2b_con_fecha_F2_posicion_null_y_bloqueante_null', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // La rama 2d NO usa el `actualizarFecha` de 2b/2c/2v (que solo toca la fecha):
    // necesita cambiar sub_estado + posicion_cola + consulta_bloqueante_id atómicamente.
    expect(repos.reservas.moverFueraDeCola).toHaveBeenCalledTimes(1);
    expect(repos.reservas.moverFueraDeCola).toHaveBeenCalledWith(
      expect.objectContaining({ idReserva: RESERVA_ID, fechaEvento: F2 }),
    );
  });

  it('debe_reordenar_la_cola_vieja_cerrando_el_hueco_contiguo_desde_1', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // Lee la cola hermana (mismo bloqueante) y aplica el decremento de las posiciones > P.
    expect(repos.reservas.leerColaHermana).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, consultaBloqueanteId: BLOQUEANTE_ID }),
    );
    expect(repos.reservas.reordenarCola).toHaveBeenCalledTimes(1);
    // R4 (posición 3 > P=2) baja a 2; R2 (posición 1 < P) no cambia.
    const arg = repos.reservas.reordenarCola.mock.calls[0][0];
    const lista: Array<{ idReserva: string; posicionCola: number }> = Array.isArray(arg)
      ? arg
      : arg.reordenamientos;
    const porId = new Map(lista.map((r) => [r.idReserva, r.posicionCola]));
    expect(porId.get('R4')).toBe(2);
  });

  it('debe_crear_un_borrador_E1_disponible_sin_autoenviar', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(repos.comunicaciones.crearBorradorE1).toHaveBeenCalledTimes(1);
    const params = repos.comunicaciones.crearBorradorE1.mock.calls[0][0];
    expect(params).toEqual(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        codigoEmail: 'E1',
        estado: 'borrador',
        fechaEnvio: null,
      }),
    );
    // La plantilla es la rama 'disponible' (transición a fecha libre).
    expect(params.tipo ?? params.plantilla).toBe('disponible');
  });

  it('debe_auditar_actualizar_RESERVA', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const reg = repos.auditoria.registrar.mock.calls[0][0];
    expect(reg.accion).toBe('actualizar');
    expect(reg.entidad).toBe('RESERVA');
    expect(reg.entidadId).toBe(RESERVA_ID);
  });

  it('NO_debe_promover_ninguna_cola_ni_liberar_ninguna_fecha_antigua', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // La 2d no posee bloqueo propio: no libera F1 ni promueve (el bloqueante B sigue intacto).
    expect(repos.promocionCola.promoverPrimeroEnCola).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.liberar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. Rama 2d, fecha OCUPADA — 409 terminal, shape solo `motivo`, rollback total.
// ===========================================================================

describe('CambiarFecha rama 2d — fecha ocupada aborta con conflicto 409 terminal', () => {
  const ocupada: EstadoFechaDestino = {
    tipo: 'bloqueada',
    reservaBloqueanteId: 'otra-reserva',
    estadoBloqueante: 'consulta',
    subEstadoBloqueante: '2b',
  };

  it('debe_lanzar_CambiarFechaConflicto_sin_mutar_nada', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: ocupada });
    const uc = new CambiarFechaUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      CambiarFechaConflictoError,
    );

    // Rollback total: nada de la rama 2d se ejecuta.
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.reservas.moverFueraDeCola).not.toHaveBeenCalled();
    expect(repos.reservas.reordenarCola).not.toHaveBeenCalled();
    expect(repos.comunicaciones.crearBorradorE1).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('el_error_es_terminal_shape_solo_motivo_sin_colaDisponible', async () => {
    const { deps } = construir({ estadoFechaDestino: ocupada });
    const uc = new CambiarFechaUseCase(deps);

    const error = await uc.ejecutar(comando()).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'CAMBIAR_FECHA_CONFLICTO' });
    expect(typeof (error as CambiarFechaConflictoError).motivo).toBe('string');
    expect(error).not.toHaveProperty('colaDisponible');
  });
});

// ===========================================================================
// 3. Rama 2d — la RESERVA bloqueante B y su FECHA_BLOQUEADA NO se tocan (fecha libre).
// ===========================================================================

describe('CambiarFecha rama 2d — no modifica el bloqueante ni su FECHA_BLOQUEADA', () => {
  it('no_debe_liberar_ni_bloquear_la_fecha_antigua_de_la_cola', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // Solo se bloquea F2 (una única llamada), nunca F1 (fecha antigua de la cola).
    const fechasBloqueadas = repos.fechaBloqueada.bloquear.mock.calls.map(
      (c) => (c[0] as { fecha: Date }).fecha,
    );
    expect(fechasBloqueadas).toEqual([F2]);
    expect(repos.fechaBloqueada.liberar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Guarda de origen — la rama 2d NO debe caer en el 422 de la guarda 2b/2c/2v.
//    (Hoy `esOrigenValidoParaCambiarFecha` rechaza 2d → RED garantizado aquí.)
// ===========================================================================

describe('CambiarFecha rama 2d — el origen 2d NO se rechaza con 422', () => {
  it('no_debe_lanzar_CambiarFechaValidacion_desde_2d_con_fecha_libre', async () => {
    const { deps } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    const error = await uc.ejecutar(comando()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CambiarFechaValidacionError);
  });
});
