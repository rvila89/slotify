/**
 * TESTS del caso de uso `DevolverFianzaUseCase`
 * (fix-liquidacion-fianza-independientes / UC-27) — devolución COMPLETA + email E10.
 *
 * Trazabilidad: spec-delta `facturacion` ADDED "Registro de la devolución completa de la
 * fianza con email de confirmación"; design.md §D-3. Precondición `estado='post_evento'` Y
 * `fianza_status='cobrada'` (sin IBAN, importe ni motivo). En UNA tx atómica bajo
 * `SELECT ... FOR UPDATE`: `fianza_status='devuelta'`, `fianza_devuelta_fecha=now()`,
 * AUDIT_LOG `actualizar`. Guarda contra doble registro. El email E10 se dispara POST-COMMIT y
 * BEST-EFFORT (patrón `disparar-e8`): su fallo NO revierte la devolución (produce `avisoEmail`).
 *
 * Dobles de puertos in-memory (hexagonal, hook `no-infra-in-domain`), sin Prisma. Reloj
 * inyectado (determinismo).
 */
import {
  DevolverFianzaUseCase,
  ReservaDevolverFianzaNoEncontradaError,
  PrecondicionNoCumplidaError,
  DevolucionYaRegistradaError,
  MENSAJE_E10_FALLIDO,
  type DevolverFianzaDeps,
  type DevolverFianzaComando,
  type ReservaDevolverFianza,
  type RepositoriosDevolverFianza,
  type UnidadDeTrabajoDevolverFianzaPort,
  type DispararE10Port,
  type ClockPort,
} from '../application/devolver-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-post-evento-1';
const CLIENTE_ID = 'cli-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-25T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en post_evento con la fianza cobrada.
// ---------------------------------------------------------------------------

const reservaDevolvible = (
  over: Partial<ReservaDevolverFianza> = {},
): ReservaDevolverFianza => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'post_evento',
  fianzaStatus: 'cobrada',
  fianzaEur: '500.00',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW + puerto de E10 fake.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosDevolverFianza {
  reservas: {
    releerConBloqueo: jest.Mock;
    registrarDevolucion: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  reserva?: ReservaDevolverFianza | null;
} = {}): ReposFake => ({
  reservas: {
    releerConBloqueo: jest.fn(async () =>
      'reserva' in opciones ? opciones.reserva : reservaDevolvible(),
    ),
    registrarDevolucion: jest.fn(async () => undefined),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoDevolverFianzaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosDevolverFianza) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaDevolverFianza | null;
  e10Resultado?: 'enviado' | 'fallido';
  e10Lanza?: boolean;
} = {}) => {
  const repos = crearReposFake({
    ...('reserva' in opciones ? { reserva: opciones.reserva } : {}),
  });
  const uow = crearUowFake(repos);
  const disparar = jest.fn(
    async (_params: {
      tenantId: string;
      reservaId: string;
      clienteId: string;
      fianzaEur: string | null;
    }) => {
      if (opciones.e10Lanza) throw new Error('PROVEEDOR_EMAIL_CAIDO');
      return {
        resultado: opciones.e10Resultado ?? ('enviado' as const),
        comunicacionId: 'com-e10-1' as string | null,
      };
    },
  );
  const dispararE10: DispararE10Port = { disparar };
  const deps: DevolverFianzaDeps = {
    unidadDeTrabajo: uow,
    dispararE10,
    clock: relojFijo,
  };
  return {
    useCase: new DevolverFianzaUseCase(deps),
    repos,
    uow,
    disparar,
    deps,
  };
};

const comando = (
  over: Partial<DevolverFianzaComando> = {},
): DevolverFianzaComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// Camino feliz: marca devuelta con fecha, audita, dispara E10, sin avisoEmail.
// ===========================================================================

describe('DevolverFianza — camino feliz (devolución completa + E10)', () => {
  it('debe_registrar_la_devolucion_como_devuelta_con_fianza_devuelta_fecha', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.registrarDevolucion).toHaveBeenCalledTimes(1);
    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.fianzaStatus).toBe('devuelta');
    expect(args.fianzaDevueltaFecha).toEqual(AHORA);
  });

  it('debe_releer_la_RESERVA_con_bloqueo_de_fila_dentro_de_la_tx', async () => {
    const { useCase, repos, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(repos.reservas.releerConBloqueo).toHaveBeenCalledTimes(1);
    expect(repos.reservas.releerConBloqueo.mock.calls[0][0].reservaId).toBe(RESERVA_ID);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_cobrada_a_devuelta', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('actualizar');
    expect(args.entidad).toBe('RESERVA');
    expect(args.entidadId).toBe(RESERVA_ID);
    expect(args.datosAnteriores.fianzaStatus).toBe('cobrada');
    expect(args.datosNuevos.fianzaStatus).toBe('devuelta');
  });

  it('debe_disparar_E10_post_commit_con_el_cliente_y_el_importe_de_la_fianza', async () => {
    const { useCase, disparar } = montar();

    await useCase.ejecutar(comando());

    expect(disparar).toHaveBeenCalledTimes(1);
    const args = disparar.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.fianzaEur).toBe('500.00');
  });

  it('debe_devolver_el_resultado_sin_avisoEmail_cuando_E10_se_envia', async () => {
    const { useCase } = montar({ e10Resultado: 'enviado' });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fianzaStatus).toBe('devuelta');
    expect(resultado.fianzaDevueltaFecha).toEqual(AHORA);
    expect(resultado.fianzaEur).toBe('500.00');
    expect(resultado.avisoEmail).toBeNull();
  });

  it('NO_debe_transicionar_RESERVA_estado_ni_exponer_puerto_de_transicion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.reservas.registrarDevolucion.mock.calls[0][0];
    expect(args).not.toHaveProperty('estado');
    expect((repos.reservas as Record<string, unknown>).transicionar).toBeUndefined();
  });
});

// ===========================================================================
// Email E10 post-commit best-effort: su fallo NO revierte la devolución.
// ===========================================================================

describe('DevolverFianza — E10 post-commit best-effort', () => {
  it('debe_dejar_avisoEmail_cuando_E10_devuelve_fallido_sin_revertir_la_devolucion', async () => {
    const { useCase, repos } = montar({ e10Resultado: 'fallido' });

    const resultado = await useCase.ejecutar(comando());

    // La devolución SÍ se registró (no se revierte).
    expect(repos.reservas.registrarDevolucion).toHaveBeenCalledTimes(1);
    expect(resultado.fianzaStatus).toBe('devuelta');
    // Pero deja el aviso best-effort.
    expect(resultado.avisoEmail).not.toBeNull();
    expect(resultado.avisoEmail?.codigo).toBe('e10_fallido');
    expect(resultado.avisoEmail?.mensaje).toBe(MENSAJE_E10_FALLIDO);
    expect(resultado.avisoEmail?.comunicacionId).toBe('com-e10-1');
  });

  it('debe_dejar_avisoEmail_cuando_el_puerto_de_E10_lanza_sin_revertir_la_devolucion', async () => {
    const { useCase, repos } = montar({ e10Lanza: true });

    const resultado = await useCase.ejecutar(comando());

    expect(repos.reservas.registrarDevolucion).toHaveBeenCalledTimes(1);
    expect(resultado.fianzaStatus).toBe('devuelta');
    expect(resultado.avisoEmail?.codigo).toBe('e10_fallido');
    expect(resultado.avisoEmail?.comunicacionId).toBeNull();
  });
});

// ===========================================================================
// Guarda de doble registro: fianza ya devuelta → DevolucionYaRegistradaError,
// sin registrar ni disparar E10.
// ===========================================================================

describe('DevolverFianza — doble registro bloqueado', () => {
  it('debe_rechazar_con_DevolucionYaRegistrada_cuando_la_fianza_ya_esta_devuelta', async () => {
    const { useCase } = montar({ reserva: reservaDevolvible({ fianzaStatus: 'devuelta' }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DevolucionYaRegistradaError,
    );
  });

  it('no_debe_registrar_ni_disparar_E10_cuando_ya_estaba_devuelta', async () => {
    const { useCase, repos, disparar } = montar({
      reserva: reservaDevolvible({ fianzaStatus: 'devuelta' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DevolucionYaRegistradaError,
    );
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
    expect(disparar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Precondición: estado != post_evento o fianza_status != cobrada →
// PrecondicionNoCumplidaError (409), sin efectos.
// ===========================================================================

describe('DevolverFianza — precondición no cumplida → 409', () => {
  it('debe_rechazar_cuando_el_estado_no_es_post_evento', async () => {
    const { useCase, repos } = montar({
      reserva: reservaDevolvible({ estado: 'evento_en_curso' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_cuando_la_fianza_esta_pendiente_sin_comprobante', async () => {
    const { useCase, repos } = montar({
      reserva: reservaDevolvible({ fianzaStatus: 'pendiente' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );
    expect(repos.reservas.registrarDevolucion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 404 / RLS: RESERVA inexistente para el tenant.
// ===========================================================================

describe('DevolverFianza — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaDevolverFianzaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase, disparar } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaDevolverFianzaNoEncontradaError,
    );
    expect(disparar).not.toHaveBeenCalled();
  });
});
