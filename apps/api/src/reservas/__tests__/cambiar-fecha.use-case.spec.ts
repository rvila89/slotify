/**
 * TESTS del caso de uso `CambiarFechaUseCase` (US-051 §Punto 2 / UC-05/UC-12/UC-18) —
 * fase TDD RED. tasks.md Fase 3: 3.1 (operación atómica "cambiar fecha ya bloqueada").
 *
 * Trazabilidad: US-051, spec-delta `consultas` (Requirement "Cambio atómico de una fecha
 * ya bloqueada", escenarios "Cambiar a una fecha libre libera la antigua y bloquea la
 * nueva atómicamente", "La fecha nueva ocupada aborta el cambio sin efectos"); design.md
 * §D-2.1 (liberar antigua + bloquear nueva en UNA transacción con `SELECT … FOR UPDATE`),
 * §D-2.2 (TDD de concurrencia obligatorio). Contrato CONGELADO `docs/api-spec.yml` op
 * `POST /reservas/{id}/cambiar-fecha` (`CambiarFechaRequest { fechaEvento }`;
 * 409 `CambiarFechaConflictoError`; 422 guarda/fecha; 404 no encontrada).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la concurrencia REALES viven
 * en `cambiar-fecha-concurrencia.spec.ts` y `cambiar-fecha-integracion.spec.ts` (Postgres
 * real, `SELECT … FOR UPDATE` + `UNIQUE(tenant, fecha)`); aquí se fija la ORQUESTACIÓN:
 *   - guarda de origen (solo `2b/2c/2v`; el resto → 422);
 *   - fecha nueva estrictamente futura (`> hoy`) → 422 (sin efectos);
 *   - fecha nueva LIBRE → bloquear nueva + `RESERVA.fechaEvento=nueva` + liberar antigua
 *     (+ promoción FIFO si la antigua tenía cola) + AUDIT_LOG `actualizar` (F1→F2);
 *   - fecha nueva OCUPADA → `CambiarFechaConflictoError` (409), rollback total;
 *   - estado/subEstado se conservan; cross-tenant → 404.
 *
 * RED: aún NO existe `application/cambiar-fecha.use-case.ts` ni sus puertos/tipos/errores.
 * Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  CambiarFechaUseCase,
  CambiarFechaConflictoError,
  CambiarFechaValidacionError,
  ReservaNoEncontradaError,
  type CambiarFechaComando,
  type CambiarFechaDeps,
  type ReservaCambioFecha,
  type EstadoFechaDestino,
  type RepositoriosCambiarFecha,
  type UnidadDeTrabajoCambiarFechaPort,
  type ClockPort,
} from '../application/cambiar-fecha.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const F1 = new Date('2027-09-12T00:00:00.000Z'); // fecha antigua (ya bloqueada)
const F2 = new Date('2027-10-20T00:00:00.000Z'); // fecha nueva
const AHORA = new Date('2026-06-28T10:00:00.000Z');
const HOY = new Date('2026-06-28T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

type ReservaRepoFake = {
  buscarPorId: jest.Mock;
  actualizarFecha: jest.Mock;
};

type FechaBloqueadaFake = {
  leerEstadoFecha: jest.Mock;
  bloquear: jest.Mock;
  liberar: jest.Mock;
  tieneCola: jest.Mock;
};

interface ReposFake extends RepositoriosCambiarFecha {
  reservas: ReservaRepoFake;
  fechaBloqueada: FechaBloqueadaFake;
  promocionCola: { promoverPrimeroEnCola: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

/** RESERVA semilla en su estado de origen (por defecto `consulta`/`2b` con F1 bloqueada). */
const reservaOrigen = (over: Partial<ReservaCambioFecha> = {}): ReservaCambioFecha => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'consulta',
  subEstado: '2b',
  fechaEvento: F1,
  ...over,
});

const crearReposFake = (opciones: {
  estadoFechaDestino: EstadoFechaDestino;
  reserva?: ReservaCambioFecha | null;
  antiguaTieneCola?: boolean;
}): ReposFake => {
  const reserva =
    opciones.reserva === undefined ? reservaOrigen() : opciones.reserva;
  const reservas: ReservaRepoFake = {
    buscarPorId: jest.fn(async () => reserva),
    actualizarFecha: jest.fn(async (p: { idReserva: string; fechaEvento: Date }) => ({
      ...reservaOrigen(),
      ...(reserva ?? {}),
      fechaEvento: p.fechaEvento,
    })),
  };
  const fechaBloqueada: FechaBloqueadaFake = {
    leerEstadoFecha: jest.fn(async () => opciones.estadoFechaDestino),
    bloquear: jest.fn(async () => undefined),
    liberar: jest.fn(async () => undefined),
    tieneCola: jest.fn(async () => opciones.antiguaTieneCola ?? false),
  };
  const promocionCola = { promoverPrimeroEnCola: jest.fn(async () => undefined) };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  return { reservas, fechaBloqueada, promocionCola, auditoria };
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
  antiguaTieneCola?: boolean;
}): Escenario => {
  const repos = crearReposFake({
    estadoFechaDestino: opciones.estadoFechaDestino ?? { tipo: 'libre' },
    reserva: opciones.reserva,
    antiguaTieneCola: opciones.antiguaTieneCola,
  });
  const uow = crearUoWFake(repos);
  const clock: ClockPort = { ahora: () => AHORA };
  const deps: CambiarFechaDeps = { unidadDeTrabajo: uow, clock };
  return { deps, repos, uow };
};

const comando = (
  over: Partial<CambiarFechaComando> = {},
): CambiarFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  fechaEvento: F2,
  ...over,
});

// ===========================================================================
// 1. Fecha nueva LIBRE → bloquear F2 + RESERVA.fecha=F2 + liberar F1, todo en UNA
//    transacción; estado/subEstado se conservan; audita F1→F2.
// ===========================================================================

describe('CambiarFecha — a fecha libre: bloquea nueva, mueve, libera antigua (escenario 1)', () => {
  it('debe_bloquear_F2_actualizar_la_fecha_y_liberar_F1_en_una_sola_transaccion', async () => {
    const { deps, repos, uow } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // TODO ocurre dentro de UNA unidad de trabajo bajo el tenant del JWT.
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar).toHaveBeenCalledWith(TENANT, expect.any(Function));

    // Bloquea la fecha NUEVA (F2) para esta RESERVA.
    expect(repos.fechaBloqueada.bloquear).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: F2, reservaId: RESERVA_ID }),
    );
    // Actualiza `RESERVA.fecha_evento = F2`.
    expect(repos.reservas.actualizarFecha).toHaveBeenCalledWith(
      expect.objectContaining({ idReserva: RESERVA_ID, fechaEvento: F2 }),
    );
    // Libera la fecha ANTIGUA (F1).
    expect(repos.fechaBloqueada.liberar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: F1, reservaId: RESERVA_ID }),
    );
  });

  it('no_debe_cambiar_estado_ni_subEstado', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // El único write de RESERVA es la fecha; no escribe estado/subEstado.
    const params = repos.reservas.actualizarFecha.mock.calls[0][0];
    expect(params).not.toHaveProperty('estado');
    expect(params).not.toHaveProperty('subEstado');
  });

  it('debe_auditar_actualizar_RESERVA_con_la_fecha_anterior_F1_y_la_nueva_F2', async () => {
    const { deps, repos } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const registro = repos.auditoria.registrar.mock.calls[0][0];
    expect(registro.accion).toBe('actualizar');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.entidadId).toBe(RESERVA_ID);
    expect(registro.usuarioId).toBe(GESTOR);
    expect(registro.datosAnteriores).toEqual(
      expect.objectContaining({ fecha_evento: F1 }),
    );
    expect(registro.datosNuevos).toEqual(
      expect.objectContaining({ fecha_evento: F2 }),
    );
  });

  it.each(['2b', '2c', '2v'] as const)(
    'debe_permitir_el_cambio_desde_el_origen_valido_%s',
    async (sub) => {
      const { deps, repos } = construir({
        estadoFechaDestino: { tipo: 'libre' },
        reserva: reservaOrigen({ subEstado: sub }),
      });
      const uc = new CambiarFechaUseCase(deps);

      await uc.ejecutar(comando());

      expect(repos.reservas.actualizarFecha).toHaveBeenCalledTimes(1);
    },
  );
});

// ===========================================================================
// 3. La fecha ANTIGUA tenía cola → promoción FIFO (A15) del primero en cola,
//    exactamente una vez, al liberar F1.
// ===========================================================================

describe('CambiarFecha — liberar F1 con cola dispara la promoción FIFO (escenario 3)', () => {
  it('debe_promover_al_primero_en_cola_de_F1_exactamente_una_vez_al_liberar', async () => {
    const { deps, repos } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      antiguaTieneCola: true,
    });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    // La liberación de F1 con cola dispara la promoción FIFO exactamente una vez.
    expect(repos.promocionCola.promoverPrimeroEnCola).toHaveBeenCalledTimes(1);
    expect(repos.promocionCola.promoverPrimeroEnCola).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: F1 }),
    );
  });

  it('no_debe_promover_cuando_la_fecha_antigua_no_tenia_cola', async () => {
    const { deps, repos } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      antiguaTieneCola: false,
    });
    const uc = new CambiarFechaUseCase(deps);

    await uc.ejecutar(comando());

    expect(repos.promocionCola.promoverPrimeroEnCola).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Fecha nueva OCUPADA por otra RESERVA → 409 conflicto, rollback total: no se
//    bloquea la nueva, no se actualiza la fecha, no se libera la antigua, no audita.
// ===========================================================================

describe('CambiarFecha — fecha nueva ocupada aborta con conflicto (escenario 4)', () => {
  it('debe_lanzar_CambiarFechaConflicto_cuando_F2_esta_bloqueada_por_otra_reserva', async () => {
    const { deps, repos } = construir({
      estadoFechaDestino: {
        tipo: 'bloqueada',
        reservaBloqueanteId: 'otra-reserva',
        estadoBloqueante: 'consulta',
        subEstadoBloqueante: '2b',
      },
    });
    const uc = new CambiarFechaUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      CambiarFechaConflictoError,
    );

    // Rollback total: NO se muta nada (ni bloqueo nuevo, ni fecha, ni liberación, ni audit).
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.reservas.actualizarFecha).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.liberar).not.toHaveBeenCalled();
    expect(repos.promocionCola.promoverPrimeroEnCola).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_exponer_code_CAMBIAR_FECHA_CONFLICTO_y_un_motivo_en_el_error', async () => {
    const { deps } = construir({
      estadoFechaDestino: {
        tipo: 'bloqueada',
        reservaBloqueanteId: 'otra-reserva',
        estadoBloqueante: 'consulta',
        subEstadoBloqueante: '2b',
      },
    });
    const uc = new CambiarFechaUseCase(deps);

    const error = await uc.ejecutar(comando()).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'CAMBIAR_FECHA_CONFLICTO' });
    expect(typeof (error as CambiarFechaConflictoError).motivo).toBe('string');
    // El conflicto es terminal: NO ofrece cola (no expone `colaDisponible`).
    expect(error).not.toHaveProperty('colaDisponible');
  });
});

// ===========================================================================
// Guarda de ORIGEN — solo `2b/2c/2v`; `2a`/`2d`/terminales/pre_reserva+ → 422 sin efectos.
// ===========================================================================

describe('CambiarFecha — guarda de origen (solo 2b/2c/2v)', () => {
  it.each([
    ['consulta', '2a'],
    ['consulta', '2d'],
    ['consulta', '2x'],
    ['consulta', '2y'],
    ['consulta', '2z'],
  ] as const)(
    'debe_rechazar_con_validacion_422_desde_%s/%s_sin_mutar_nada',
    async (estado, sub) => {
      const { deps, repos } = construir({
        estadoFechaDestino: { tipo: 'libre' },
        reserva: reservaOrigen({ estado, subEstado: sub }),
      });
      const uc = new CambiarFechaUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
        CambiarFechaValidacionError,
      );

      expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
      expect(repos.reservas.actualizarFecha).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.liberar).not.toHaveBeenCalled();
    },
  );

  it('debe_rechazar_con_validacion_422_desde_pre_reserva', async () => {
    const { deps, repos } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      reserva: reservaOrigen({ estado: 'pre_reserva', subEstado: null }),
    });
    const uc = new CambiarFechaUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      CambiarFechaValidacionError,
    );
    expect(repos.reservas.actualizarFecha).not.toHaveBeenCalled();
  });

  it('el_error_de_guarda_debe_discriminar_tipo_guarda_para_mapear_a_422', async () => {
    const { deps } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      reserva: reservaOrigen({ subEstado: '2a', fechaEvento: null }),
    });
    const uc = new CambiarFechaUseCase(deps);

    const error = await uc.ejecutar(comando()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CambiarFechaValidacionError);
    expect((error as CambiarFechaValidacionError).tipo).toBe('guarda');
  });
});

// ===========================================================================
// Validación de FECHA nueva — debe ser estrictamente futura (`> hoy`) → 422 sin efectos.
// ===========================================================================

describe('CambiarFecha — la fecha nueva debe ser estrictamente futura (> hoy)', () => {
  it('debe_rechazar_fecha_igual_a_hoy_sin_abrir_la_transaccion', async () => {
    const { deps, repos, uow } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    const error = await uc
      .ejecutar(comando({ fechaEvento: HOY }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CambiarFechaValidacionError);
    expect((error as CambiarFechaValidacionError).tipo).toBe('fecha');
    // Rechazo ANTES de tocar la BD: no se abre la tx.
    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
  });

  it('debe_rechazar_fecha_en_el_pasado_sin_efectos', async () => {
    const { deps, uow } = construir({ estadoFechaDestino: { tipo: 'libre' } });
    const uc = new CambiarFechaUseCase(deps);

    await expect(
      uc.ejecutar(comando({ fechaEvento: new Date('2020-01-01T00:00:00.000Z') })),
    ).rejects.toBeInstanceOf(CambiarFechaValidacionError);
    expect(uow.ejecutar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// RLS / multi-tenant — cross-tenant → RESERVA no encontrada (404). Tenant del JWT.
// ===========================================================================

describe('CambiarFecha — reserva inexistente o de otro tenant (404)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      reserva: null,
    });
    const uc = new CambiarFechaUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );

    // Sin efectos.
    expect(repos.fechaBloqueada.bloquear).not.toHaveBeenCalled();
    expect(repos.reservas.actualizarFecha).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_exponer_code_RESERVA_NO_ENCONTRADA', async () => {
    const { deps } = construir({
      estadoFechaDestino: { tipo: 'libre' },
      reserva: null,
    });
    const uc = new CambiarFechaUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toMatchObject({ codigo: 'RESERVA_NO_ENCONTRADA' });
  });
});
