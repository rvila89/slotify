/**
 * TESTS DE DOMINIO de la operación `bloquearFecha()` (US-040 / UC-30) — fase TDD RED.
 *
 * Trazabilidad: US-040, spec-delta `bloqueo-fecha`, design.md (D-2 mapa
 * declarativo, D-4 errores de dominio, D-6 multi-tenancy, D-8 orden de
 * evaluación). Dolor D4 (anti-doble-reserva).
 *
 * Estos tests ejercitan el DOMINIO PURO contra DOBLES DE LOS PUERTOS (in-memory),
 * sin tocar Prisma ni la BD (hexagonal, hook `no-infra-in-domain`). Cubren:
 *   - el mapa canónico fase → (tipo, ttl, modo) leído de TENANT_SETTINGS (D-2),
 *   - las validaciones previas a la transacción (D-8 paso 1: fecha pasada,
 *     tenant mismatch, fase/tipo inválido),
 *   - que la operación SOLO muta FECHA_BLOQUEADA (no la RESERVA),
 *   - la propagación de FECHA_YA_BLOQUEADA emitida por el repositorio.
 *
 * La zona crítica de CONCURRENCIA (1 éxito + 1 P2002) y los CHECK CONSTRAINTS
 * viven en los specs de integración hermanos (BD real).
 *
 * RED: en este punto NO existe `reservas/domain/bloquear-fecha.service.ts`; el
 * import falla y toda la batería está en ROJO. La fase GREEN es responsabilidad
 * de `backend-developer`.
 */
import {
  BloquearFechaService,
  resolverPlanBloqueo,
  FechaEnPasadoError,
  TenantMismatchError,
  ValidacionBloqueoError,
  FechaYaBloqueadaError,
  type FaseBloqueo,
  type PlanBloqueo,
  type TenantSettingsBloqueo,
  type BloquearFechaComando,
  type FechaBloqueadaResultado,
  type FechaBloqueadaRepositoryPort,
  type TenantSettingsPort,
  type ClockPort,
} from '../domain/bloquear-fecha.service';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

const RESERVA_R = 'reserva-R';
const DIA_MS = 24 * 60 * 60 * 1000;

// TENANT_SETTINGS por defecto del piloto (seed): 3 días consulta / 7 pre-reserva.
const SETTINGS_DEFECTO: TenantSettingsBloqueo = {
  ttlConsultaDias: 3,
  ttlPrereservaDias: 7,
};

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DIA_MS);

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El dominio depende de estas INTERFACES;
// aquí van implementaciones fake con spies para verificar llamadas y argumentos.
// ---------------------------------------------------------------------------

type RepoPortFake = FechaBloqueadaRepositoryPort & { bloquear: jest.Mock };
type SettingsPortFake = TenantSettingsPort & { obtener: jest.Mock };

/** Repo fake: por defecto resuelve un resultado que refleja el plan aplicado. */
const crearRepoPortFake = (): RepoPortFake => {
  const bloquear = jest.fn(
    async (params: {
      tenantId: string;
      fecha: Date;
      reservaId: string;
      plan: PlanBloqueo;
    }): Promise<FechaBloqueadaResultado> => ({
      idBloqueo: 'bloqueo-1',
      tenantId: params.tenantId,
      fecha: params.fecha,
      reservaId: params.reservaId,
      tipoBloqueo: params.plan.tipo,
      ttlExpiracion: params.plan.ttl,
    }),
  );
  return { bloquear };
};

const crearSettingsPortFake = (
  settings: TenantSettingsBloqueo | null = SETTINGS_DEFECTO,
  tenantId = TENANT,
): SettingsPortFake => {
  const obtener = jest.fn(async (t: string) => (t === tenantId ? settings : null));
  return { obtener };
};

/** Reloj fijo para determinismo: por defecto "ahora" = 2026-06-27. */
const relojFijo = (iso = '2026-06-27T00:00:00.000Z'): ClockPort => ({
  ahora: () => new Date(iso),
});

const montarServicio = (opts?: {
  repo?: RepoPortFake;
  settings?: SettingsPortFake;
  clock?: ClockPort;
}) => {
  const repo = opts?.repo ?? crearRepoPortFake();
  const settings = opts?.settings ?? crearSettingsPortFake();
  const clock = opts?.clock ?? relojFijo();
  const servicio = new BloquearFechaService({
    repositorio: repo,
    tenantSettings: settings,
    clock,
  });
  return { servicio, repo, settings, clock };
};

const comandoBase = (over: Partial<BloquearFechaComando> = {}): BloquearFechaComando => ({
  tenantId: TENANT,
  fase: '2.b',
  fecha: new Date('2026-09-12'),
  reserva: { idReserva: RESERVA_R, tenantId: TENANT },
  ...over,
});

// ===========================================================================
// 1. Mapa canónico fase → (tipo, ttl, modo) — función pura (D-2)
//    spec-delta: "Mapa canónico fase → tipo de bloqueo y TTL"
// ===========================================================================

describe('Mapa canónico fase → (tipo, ttl, modo) — resolverPlanBloqueo', () => {
  const ahora = new Date('2026-06-27T00:00:00.000Z');

  it('debe_resolver_2b_a_blando_insert_con_ttl_ahora_mas_ttl_consulta_dias', () => {
    const plan = resolverPlanBloqueo({ fase: '2.b', ahora, settings: SETTINGS_DEFECTO });

    expect(plan.modo).toBe('insert');
    expect(plan.tipo).toBe('blando');
    expect(plan.ttl?.getTime()).toBe(addDays(ahora, 3).getTime());
  });

  it('debe_leer_el_ttl_de_TENANT_SETTINGS_y_no_hardcodear_3_dias', () => {
    // ttl_consulta_dias = 5 (valor NO por defecto) -> ttl = ahora + 5d, no +3d.
    const plan = resolverPlanBloqueo({
      fase: '2.b',
      ahora,
      settings: { ttlConsultaDias: 5, ttlPrereservaDias: 7 },
    });

    expect(plan.ttl?.getTime()).toBe(addDays(ahora, 5).getTime());
    expect(plan.ttl?.getTime()).not.toBe(addDays(ahora, 3).getTime());
  });

  it('debe_resolver_2v_a_blando_con_ttl_visita_mas_un_dia', () => {
    const visita = new Date('2026-08-01T00:00:00.000Z');
    const plan = resolverPlanBloqueo({
      fase: '2.v',
      ahora,
      settings: SETTINGS_DEFECTO,
      visitaProgramadaFecha: visita,
    });

    expect(plan.modo).toBe('insert');
    expect(plan.tipo).toBe('blando');
    expect(plan.ttl?.getTime()).toBe(addDays(visita, 1).getTime());
  });

  it('debe_resolver_pre_reserva_a_blando_con_ttl_ahora_mas_ttl_prereserva_dias', () => {
    const plan = resolverPlanBloqueo({ fase: 'pre_reserva', ahora, settings: SETTINGS_DEFECTO });

    expect(plan.modo).toBe('insert');
    expect(plan.tipo).toBe('blando');
    expect(plan.ttl?.getTime()).toBe(addDays(ahora, 7).getTime());
  });

  it('debe_resolver_2c_a_extension_de_ttl_sin_cambiar_el_tipo', () => {
    // 2.c extiende el TTL existente (delta = ttl_consulta_dias) y NO cambia el tipo.
    const plan = resolverPlanBloqueo({ fase: '2.c', ahora, settings: SETTINGS_DEFECTO });

    expect(plan.modo).toBe('extend');
    expect(plan.tipo).toBe('blando');
    expect(plan.ttlDeltaDias).toBe(3);
  });

  it('debe_resolver_reserva_confirmada_a_upgrade_firme_con_ttl_null', () => {
    const plan = resolverPlanBloqueo({ fase: 'reserva_confirmada', ahora, settings: SETTINGS_DEFECTO });

    expect(plan.modo).toBe('upgrade');
    expect(plan.tipo).toBe('firme');
    expect(plan.ttl).toBeNull();
  });

  it('debe_rechazar_una_fase_no_contemplada_en_el_mapa', () => {
    expect(() =>
      resolverPlanBloqueo({
        fase: 'fase_inexistente' as unknown as FaseBloqueo,
        ahora,
        settings: SETTINGS_DEFECTO,
      }),
    ).toThrow(ValidacionBloqueoError);
  });
});

// ===========================================================================
// 2. Servicio: aplica el plan resuelto vía el repositorio (D-8 pasos 2-4)
//    spec-delta: "Bloqueo atómico …", "Upgrade … a firme", "Extensión de TTL en 2.c"
// ===========================================================================

describe('BloquearFechaService aplica el plan vía el repositorio', () => {
  it('debe_insertar_bloqueo_blando_en_2b_con_ttl_leido_de_settings', async () => {
    const { servicio, repo } = montarServicio({
      settings: crearSettingsPortFake({ ttlConsultaDias: 5, ttlPrereservaDias: 7 }),
    });

    const out = await servicio.ejecutar(comandoBase({ fase: '2.b' }));

    expect(repo.bloquear).toHaveBeenCalledTimes(1);
    const args = repo.bloquear.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_R);
    expect(args.plan.modo).toBe('insert');
    expect(args.plan.tipo).toBe('blando');
    expect(args.plan.ttl?.getTime()).toBe(
      addDays(new Date('2026-06-27T00:00:00.000Z'), 5).getTime(),
    );
    expect(out.tipoBloqueo).toBe('blando');
  });

  it('debe_promover_a_firme_con_upgrade_preservando_el_reserva_id', async () => {
    const { servicio, repo } = montarServicio();

    await servicio.ejecutar(comandoBase({ fase: 'reserva_confirmada' }));

    const args = repo.bloquear.mock.calls[0][0];
    expect(args.plan.modo).toBe('upgrade');
    expect(args.plan.tipo).toBe('firme');
    expect(args.plan.ttl).toBeNull();
    // El reserva_id se propaga inalterado al UPDATE (nunca DELETE+INSERT).
    expect(args.reservaId).toBe(RESERVA_R);
  });

  it('debe_extender_el_ttl_en_2c_con_modo_extend_y_tipo_blando', async () => {
    const { servicio, repo } = montarServicio();

    await servicio.ejecutar(comandoBase({ fase: '2.c' }));

    const args = repo.bloquear.mock.calls[0][0];
    expect(args.plan.modo).toBe('extend');
    expect(args.plan.tipo).toBe('blando');
    expect(args.plan.ttlDeltaDias).toBe(3);
  });

  it('debe_usar_la_fecha_de_visita_mas_un_dia_en_2v', async () => {
    const visita = new Date('2026-08-01T00:00:00.000Z');
    const { servicio, repo } = montarServicio();

    await servicio.ejecutar(
      comandoBase({
        fase: '2.v',
        reserva: { idReserva: RESERVA_R, tenantId: TENANT, visitaProgramadaFecha: visita },
      }),
    );

    const args = repo.bloquear.mock.calls[0][0];
    expect(args.plan.tipo).toBe('blando');
    expect(args.plan.ttl?.getTime()).toBe(addDays(visita, 1).getTime());
  });

  it('no_debe_mutar_la_reserva_solo_invoca_el_repositorio_de_bloqueo', async () => {
    // El servicio no recibe ningún puerto de escritura de RESERVA: su única
    // dependencia mutadora es el repositorio de FECHA_BLOQUEADA.
    const { servicio, repo } = montarServicio();

    await servicio.ejecutar(comandoBase());

    expect(repo.bloquear).toHaveBeenCalledTimes(1);
    // El servicio no expone ningún colaborador para mutar la reserva.
    expect(Object.keys(servicio)).not.toContain('reservaRepository');
  });
});

// ===========================================================================
// 3. Validaciones previas a la transacción (D-8 paso 1, D-4)
//    spec-delta: "Validaciones de dominio previas a la transacción"
// ===========================================================================

describe('Validaciones de dominio previas a la transacción', () => {
  it('debe_lanzar_FECHA_EN_PASADO_y_no_tocar_el_repositorio', async () => {
    // Reloj a 2026-06-27; fecha solicitada anterior.
    const { servicio, repo } = montarServicio();

    await expect(
      servicio.ejecutar(comandoBase({ fecha: new Date('2020-01-01') })),
    ).rejects.toBeInstanceOf(FechaEnPasadoError);

    expect(repo.bloquear).not.toHaveBeenCalled();
  });

  it('debe_rechazar_la_fecha_del_mismo_dia_la_fecha_debe_ser_estrictamente_futura', async () => {
    const { servicio, repo } = montarServicio({
      clock: relojFijo('2026-06-27T14:00:00.000Z'),
    });

    await expect(
      servicio.ejecutar(comandoBase({ fecha: new Date('2026-06-27') })),
    ).rejects.toBeInstanceOf(FechaEnPasadoError);
    expect(repo.bloquear).not.toHaveBeenCalled();
  });

  it('debe_exponer_la_fecha_en_el_detalle_de_FECHA_EN_PASADO', async () => {
    const { servicio } = montarServicio();

    await expect(
      servicio.ejecutar(comandoBase({ fecha: new Date('2020-01-01') })),
    ).rejects.toMatchObject({ codigo: 'FECHA_EN_PASADO' });
  });

  it('debe_lanzar_TENANT_MISMATCH_cuando_el_tenant_del_bloqueo_difiere_del_de_la_reserva', async () => {
    const { servicio, repo } = montarServicio();

    // El contexto bloquea para TENANT pero la reserva pertenece a OTRO_TENANT.
    await expect(
      servicio.ejecutar(
        comandoBase({ reserva: { idReserva: RESERVA_R, tenantId: OTRO_TENANT } }),
      ),
    ).rejects.toBeInstanceOf(TenantMismatchError);

    expect(repo.bloquear).not.toHaveBeenCalled();
  });

  it('debe_rechazar_una_fase_invalida_antes_de_abrir_la_transaccion', async () => {
    const { servicio, repo } = montarServicio();

    await expect(
      servicio.ejecutar(comandoBase({ fase: 'estado_raro' as unknown as FaseBloqueo })),
    ).rejects.toBeInstanceOf(ValidacionBloqueoError);
    expect(repo.bloquear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Propagación del rechazo atómico (D-4)
//    spec-delta: "Rechazo atómico determinista si la fecha ya está bloqueada"
// ===========================================================================

describe('Propagación de FECHA_YA_BLOQUEADA emitida por el repositorio', () => {
  it('debe_propagar_FECHA_YA_BLOQUEADA_sin_envolverla_cuando_el_repo_la_lanza', async () => {
    // El adaptador traduce el P2002 de Prisma a FechaYaBloqueadaError; el
    // servicio debe propagarlo intacto al flujo invocante (que decidirá cola).
    const repo = crearRepoPortFake();
    repo.bloquear.mockRejectedValueOnce(
      new FechaYaBloqueadaError(TENANT, new Date('2026-09-12'), 'reserva-existente'),
    );
    const { servicio } = montarServicio({ repo });

    await expect(servicio.ejecutar(comandoBase())).rejects.toBeInstanceOf(
      FechaYaBloqueadaError,
    );
  });

  it('debe_propagar_el_detalle_de_diagnostico_del_rechazo', async () => {
    const repo = crearRepoPortFake();
    repo.bloquear.mockRejectedValueOnce(
      new FechaYaBloqueadaError(TENANT, new Date('2026-09-12'), 'reserva-existente'),
    );
    const { servicio } = montarServicio({ repo });

    await expect(servicio.ejecutar(comandoBase())).rejects.toMatchObject({
      codigo: 'FECHA_YA_BLOQUEADA',
    });
  });
});
