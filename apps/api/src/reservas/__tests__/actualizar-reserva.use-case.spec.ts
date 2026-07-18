/**
 * TESTS del caso de uso `ActualizarReservaUseCase` (US-051 §Punto 2 / UC-14) —
 * fase TDD RED. tasks.md Fase 3: 3.2 (PATCH campos simples).
 *
 * Trazabilidad: US-051, spec-delta `consultas` (Requirement "Edición de los datos de
 * una consulta/reserva", escenarios "Editar el nº de invitados actualiza la RESERVA sin
 * cambiar de estado", "El PATCH no muta la fecha del evento aunque se intente", "horario
 * sin duracionHoras se rechaza en servidor"); design.md §D-1 (separación fecha ↔ PATCH
 * genérico, validación cruzada de `horario`), §D-5 (`horario` aditivo al contrato).
 * Contrato CONGELADO `docs/api-spec.yml` op `PATCH /reservas/{id}`
 * (`UpdateReservaRequest`: `tipoEvento`, `duracionHoras`, `numAdultosNinosMayores4`,
 * `numNinosMenores4`, `numInvitadosFinal`, `notas`, `horario`).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La persistencia real (UPDATE parcial de columnas
 * escalares de la RESERVA + AUDIT_LOG en una transacción bajo RLS) y que NO muta
 * `fechaEvento`/`FECHA_BLOQUEADA` se verifican en el `…-integracion` / QA con Postgres
 * real; aquí se fija la ORQUESTACIÓN:
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404.
 *   1. Paso TRANSACCIONAL: UPDATE PARCIAL de los campos simples PRESENTES de la RESERVA +
 *      AUDIT_LOG (`accion='actualizar'`, `entidad='RESERVA'`). Commit.
 *   2. NUNCA persiste `fechaEvento` ni toca el bloqueo (regla dura §D-1). NO cambia
 *      estado/subEstado. Valida `duracionHoras ∈ {4,8,12}` y `horario` (`HH:mm` + cruzada).
 *
 * RED: aún NO existe `reservas/application/actualizar-reserva.use-case.ts` ni sus
 * puertos/tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ActualizarReservaUseCase,
  ReservaNoEncontradaError,
  ActualizarReservaValidacionError,
  type ActualizarReservaDeps,
  type ActualizarReservaComando,
  type ReservaActualizable,
  type CamposReservaParcial,
  type RepositoriosActualizarReserva,
  type UnidadDeTrabajoActualizarReservaPort,
} from '../application/actualizar-reserva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';

// ---------------------------------------------------------------------------
// Doble de datos: RESERVA resoluble bajo RLS con sus campos simples previos.
// Semilla en `consulta`/`2b` con fecha ya bloqueada (para verificar que el PATCH
// NUNCA muta la fecha ni cambia estado/subEstado). `duracionHoras` YA presente.
// ---------------------------------------------------------------------------

const FECHA_BLOQUEADA_PREVIA = new Date('2027-09-12T00:00:00.000Z');

const reservaActualizable = (
  over: Partial<ReservaActualizable> = {},
): ReservaActualizable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'consulta',
  subEstado: '2b',
  fechaEvento: FECHA_BLOQUEADA_PREVIA,
  tipoEvento: 'boda',
  duracionHoras: 8,
  numAdultosNinosMayores4: 30,
  numNinosMenores4: 5,
  numInvitadosFinal: null,
  horario: '11:00',
  notas: 'Prefieren jardín',
  ...over,
});

// ---------------------------------------------------------------------------
// Repos tx-bound + UoW fake. El use-case orquesta la tx de escritura parcial.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosActualizarReserva {
  reservas: { actualizarCampos: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  reservas: {
    // El adaptador real hace un UPDATE PARCIAL (solo columnas presentes) bajo RLS.
    // NUNCA incluye `fechaEvento` (regla dura §D-1).
    actualizarCampos: jest.fn(async () => ({ filasAfectadas: 1 })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoActualizarReservaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosActualizarReserva) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

interface Escenario {
  deps: ActualizarReservaDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
  cargarReserva: jest.Mock;
}

const construir = (
  opciones: { reserva?: ReservaActualizable | null } = {},
): Escenario => {
  const repos = crearReposFake();
  const uow = crearUoWFake(repos);
  const reserva =
    opciones.reserva === undefined ? reservaActualizable() : opciones.reserva;
  const cargarReserva = jest.fn(async () => reserva);
  const deps: ActualizarReservaDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
  };
  return { deps, repos, uow, cargarReserva };
};

const comando = (
  campos: CamposReservaParcial,
  over: Partial<ActualizarReservaComando> = {},
): ActualizarReservaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  campos,
  ...over,
});

// ===========================================================================
// 3.2.a — Update parcial: SOLO los campos simples enviados se persisten; los no
//          enviados NO se tocan. Audita entidad=RESERVA.
// ===========================================================================

describe('ActualizarReserva — update parcial de campos simples (3.2)', () => {
  it('debe_persistir_solo_los_campos_enviados_sin_tocar_los_ausentes', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(
      comando({ numAdultosNinosMayores4: 20, notas: 'Cambio de plan' }),
    );

    // Solo los campos presentes viajan al puerto de escritura (PATCH parcial).
    expect(repos.reservas.actualizarCampos).toHaveBeenCalledTimes(1);
    const params = repos.reservas.actualizarCampos.mock.calls[0][0];
    expect(params.idReserva).toBe(RESERVA_ID);
    expect(params.tenantId).toBe(TENANT);
    expect(params.campos).toEqual({
      numAdultosNinosMayores4: 20,
      notas: 'Cambio de plan',
    });
    // Los ausentes NO viajan (no se ponen a null).
    expect(params.campos).not.toHaveProperty('duracionHoras');
    expect(params.campos).not.toHaveProperty('tipoEvento');
    expect(params.campos).not.toHaveProperty('horario');
  });

  it('debe_persistir_todos_los_campos_simples_editables_cuando_se_envian', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(
      comando({
        tipoEvento: 'comunion',
        duracionHoras: 12,
        numAdultosNinosMayores4: 40,
        numNinosMenores4: 8,
        numInvitadosFinal: 48,
        horario: '13:30',
        notas: 'Menú especial',
      }),
    );

    const params = repos.reservas.actualizarCampos.mock.calls[0][0];
    // El conjunto de claves editables es exactamente el de UpdateReservaRequest (sin fecha).
    expect(Object.keys(params.campos).sort()).toEqual(
      [
        'duracionHoras',
        'horario',
        'notas',
        'numAdultosNinosMayores4',
        'numInvitadosFinal',
        'numNinosMenores4',
        'tipoEvento',
      ].sort(),
    );
  });

  it('debe_abrir_la_unidad_de_trabajo_bajo_el_tenant_del_jwt', async () => {
    const { deps, uow } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ notas: 'x' }));

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });
});

// ===========================================================================
// 3.2.b — NUNCA muta `fechaEvento` aunque venga en el body (regla dura §D-1): se
//          ignora/rechaza, jamás se persiste, y NUNCA toca FECHA_BLOQUEADA (no hay
//          puerto de bloqueo disponible aquí).
// ===========================================================================

describe('ActualizarReserva — la fecha del evento es sagrada, NUNCA se muta por el PATCH (3.2)', () => {
  it('no_debe_persistir_fechaEvento_aunque_venga_en_el_body', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    // El body incluye `fechaEvento` (campo ajeno / deprecado): NO debe llegar al puerto.
    // `fechaEvento` NO es un campo editable de CamposReservaParcial; se cuela por un cast
    // para simular un cliente que lo envía y verificar que el use-case NUNCA lo persiste.
    const camposConFecha = {
      duracionHoras: 12,
      fechaEvento: new Date('2028-05-10T00:00:00.000Z'),
    } as unknown as CamposReservaParcial;
    await uc.ejecutar(comando(camposConFecha));

    const params = repos.reservas.actualizarCampos.mock.calls[0][0];
    expect(params.campos).not.toHaveProperty('fechaEvento');
    // Solo el campo simple legítimo se persiste.
    expect(params.campos).toEqual({ duracionHoras: 12 });
  });

  it('el_puerto_de_escritura_NO_expone_ninguna_via_para_mutar_fecha_ni_bloqueo', async () => {
    // D-1: el único puerto de escritura disponible es el de campos simples de la RESERVA;
    // no hay `bloquearFecha`/`liberarFecha` ni escritura de `fechaEvento` en estos repos.
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ tipoEvento: 'boda' }));

    // El único repo mutador es `reservas.actualizarCampos`; no hay repos de FECHA_BLOQUEADA.
    expect(Object.keys(repos)).toEqual(expect.arrayContaining(['reservas', 'auditoria']));
    expect(repos).not.toHaveProperty('fechaBloqueada');
  });

  it('no_debe_cambiar_estado_ni_subEstado', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ numAdultosNinosMayores4: 20 }));

    const params = repos.reservas.actualizarCampos.mock.calls[0][0];
    // El PATCH nunca escribe estado/subEstado (no son campos editables por esta vía).
    expect(params.campos).not.toHaveProperty('estado');
    expect(params.campos).not.toHaveProperty('subEstado');
  });
});

// ===========================================================================
// 3.2.c — Auditoría: AUDIT_LOG `accion='actualizar'`, `entidad='RESERVA'`, con
//          datosAnteriores/datosNuevos de los campos cambiados. Origen Usuario.
// ===========================================================================

describe('ActualizarReserva — auditoría de la edición (3.2)', () => {
  it('debe_auditar_como_actualizar_entidad_RESERVA_con_valor_anterior_y_nuevo', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ numAdultosNinosMayores4: 20 }));

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const registro = repos.auditoria.registrar.mock.calls[0][0];
    expect(registro.accion).toBe('actualizar');
    expect(registro.entidad).toBe('RESERVA');
    expect(registro.entidadId).toBe(RESERVA_ID);
    expect(registro.usuarioId).toBe(GESTOR);
    expect(registro.tenantId).toBe(TENANT);
    // El payload refleja el valor previo (30) → nuevo (20) del campo cambiado.
    expect(registro.datosAnteriores).toEqual(
      expect.objectContaining({ num_adultos_ninos_mayores_4: 30 }),
    );
    expect(registro.datosNuevos).toEqual(
      expect.objectContaining({ num_adultos_ninos_mayores_4: 20 }),
    );
  });
});

// ===========================================================================
// 3.2.d — Validación: `duracionHoras ∈ {4,8,12}`; `horario` formato `HH:mm`;
//          `horario` cruzado (requiere duracionHoras presente o entrante). Rechazo
//          SIN efectos (sin abrir la tx).
// ===========================================================================

describe('ActualizarReserva — validación de duracionHoras (3.2)', () => {
  it.each([0, 1, 5, 10, 24])(
    'debe_rechazar_duracionHoras_fuera_de_4_8_12_(%p)_sin_persistir',
    async (valor) => {
      const { deps, repos } = construir();
      const uc = new ActualizarReservaUseCase(deps);

      await expect(
        uc.ejecutar(comando({ duracionHoras: valor as never })),
      ).rejects.toBeInstanceOf(ActualizarReservaValidacionError);

      expect(repos.reservas.actualizarCampos).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it.each([4, 8, 12])('debe_aceptar_duracionHoras_valida_(%p)', async (valor) => {
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ duracionHoras: valor as never }));

    expect(repos.reservas.actualizarCampos).toHaveBeenCalledTimes(1);
  });
});

describe('ActualizarReserva — validación de horario HH:mm y regla cruzada (3.2)', () => {
  it.each(['1100', '25:00', '11:60', 'ab:cd', '11', ''])(
    'debe_rechazar_horario_mal_formado_(%p)_sin_persistir',
    async (valor) => {
      // La RESERVA ya tiene duracionHoras, así que el rechazo es por el formato de horario.
      const { deps, repos } = construir();
      const uc = new ActualizarReservaUseCase(deps);

      const error = await uc
        .ejecutar(comando({ horario: valor as never }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ActualizarReservaValidacionError);
      expect((error as ActualizarReservaValidacionError).campo).toBe('horario');
      expect(repos.reservas.actualizarCampos).not.toHaveBeenCalled();
    },
  );

  it('debe_rechazar_horario_cuando_la_reserva_no_tiene_duracionHoras_ni_entra_en_el_mismo_PATCH', async () => {
    // RESERVA en 2a SIN duracionHoras: `horario` sin `duracionHoras` presente ni entrante
    // → error de validación en el campo `horario` (§D-1), sin persistir nada.
    const { deps, repos } = construir({
      reserva: reservaActualizable({
        subEstado: '2a',
        fechaEvento: null,
        duracionHoras: null,
      }),
    });
    const uc = new ActualizarReservaUseCase(deps);

    const error = await uc
      .ejecutar(comando({ horario: '10:00' }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ActualizarReservaValidacionError);
    expect((error as ActualizarReservaValidacionError).campo).toBe('horario');
    expect(repos.reservas.actualizarCampos).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_aceptar_horario_cuando_la_duracionHoras_entra_en_el_mismo_PATCH', async () => {
    // RESERVA en 2a sin duracionHoras, pero el MISMO PATCH la fija: `horario` es válido.
    const { deps, repos } = construir({
      reserva: reservaActualizable({
        subEstado: '2a',
        fechaEvento: null,
        duracionHoras: null,
      }),
    });
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ duracionHoras: 8, horario: '10:00' }));

    expect(repos.reservas.actualizarCampos).toHaveBeenCalledTimes(1);
    const params = repos.reservas.actualizarCampos.mock.calls[0][0];
    expect(params.campos).toEqual({ duracionHoras: 8, horario: '10:00' });
  });

  it('debe_aceptar_horario_cuando_la_reserva_YA_tiene_duracionHoras', async () => {
    // RESERVA ya con duracionHoras=8 (por defecto): `horario` sin reenviar duracionHoras es válido.
    const { deps, repos } = construir();
    const uc = new ActualizarReservaUseCase(deps);

    await uc.ejecutar(comando({ horario: '12:00' }));

    expect(repos.reservas.actualizarCampos).toHaveBeenCalledTimes(1);
    expect(repos.reservas.actualizarCampos.mock.calls[0][0].campos).toEqual({
      horario: '12:00',
    });
  });
});

// ===========================================================================
// 3.2.e — RLS / multi-tenant: cross-tenant → RESERVA no encontrada (404). El
//          tenant/usuario del contexto, nunca del body. Sin efectos.
// ===========================================================================

describe('ActualizarReserva — reserva inexistente o de otro tenant (3.2)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos } = construir({ reserva: null });
    const uc = new ActualizarReservaUseCase(deps);

    await expect(uc.ejecutar(comando({ notas: 'x' }))).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );

    // Sin efectos: no se abre la tx, no se actualiza la RESERVA, no se audita.
    expect(repos.reservas.actualizarCampos).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_resolver_la_reserva_con_el_tenant_del_jwt_nunca_del_body', async () => {
    const { deps, cargarReserva } = construir({ reserva: null });
    const uc = new ActualizarReservaUseCase(deps);

    await expect(
      uc.ejecutar(comando({ notas: 'x' }, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(cargarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT, reservaId: RESERVA_ID }),
    );
  });

  it('debe_exponer_code_RESERVA_NO_ENCONTRADA_en_el_error', async () => {
    const { deps } = construir({ reserva: null });
    const uc = new ActualizarReservaUseCase(deps);

    await expect(uc.ejecutar(comando({ notas: 'x' }))).rejects.toMatchObject({
      codigo: 'RESERVA_NO_ENCONTRADA',
    });
  });
});
