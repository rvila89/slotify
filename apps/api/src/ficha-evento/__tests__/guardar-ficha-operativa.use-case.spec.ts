/**
 * TESTS del caso de uso `GuardarFichaOperativaUseCase` (US-025 / UC-20) — fase TDD RED.
 * tasks.md Fase 3: 3.4 (guardado parcial + AUDIT_LOG + primer guardado con datos
 * dispara `pendiente → en_curso`) y 3.6 (edición post-cierre: persiste, actualiza
 * `fecha_cierre = now()`, `pre_evento_status` permanece `cerrado`, AUDIT_LOG).
 *
 * Trazabilidad: US-025; spec-delta `ficha-operativa` (Requirements "Guardado parcial
 * de campos de la ficha operativa", "Transición pre_evento_status pendiente →
 * en_curso al primer guardado con datos", "Edición de la ficha tras el cierre sin
 * reabrir el estado", "Guarda de acceso por estado de la RESERVA"); design.md §D-2
 * (guarda del primer guardado con datos), §D-3 (guarda de acceso), §D-4
 * (`fecha_cierre = now()` en edición post-cierre; `pre_evento_status` sigue
 * `cerrado`). Contrato congelado:
 *   - `PATCH /reservas/{id}/ficha-operativa` (`GuardarFichaOperativaRequest`,
 *     parcial) → 200 `FichaOperativa` | 409 `ficha_no_disponible` | 404.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory) dentro de una única
 * unidad de trabajo, sin tocar Prisma (hexagonal, hook `no-infra-in-domain`). La
 * atomicidad REAL (estado de BD) vive en un `…-integracion.spec.ts`; aquí se fija la
 * ORQUESTACIÓN: guarda de acceso, guardado del subconjunto enviado, disparo
 * `pendiente → en_curso` en el primer guardado con datos (idempotente), no-disparo
 * cuando el guardado no aporta datos, la edición post-cierre (persiste + reescribe
 * `fecha_cierre`, mantiene `cerrado`) y el AUDIT_LOG de cada guardado/transición.
 *
 * RED: aún NO existe `ficha-evento/application/guardar-ficha-operativa.use-case.ts`.
 * La batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  GuardarFichaOperativaUseCase,
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  type GuardarFichaOperativaDeps,
  type GuardarFichaOperativaComando,
  type ReservaFichaOperativa,
  type FichaOperativa,
  type RepositoriosFicha,
  type UnidadDeTrabajoFichaPort,
  type ClockPort,
  type EstadoReservaFicha,
} from '../application/guardar-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-conf';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const CIERRE_PREVIO = new Date('2026-07-01T09:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos.
// ---------------------------------------------------------------------------

const fichaVacia = (over: Partial<FichaOperativa> = {}): FichaOperativa => ({
  idFicha: 'ficha-1',
  reservaId: RESERVA_ID,
  numInvitadosConfirmado: null,
  menuSeleccionado: null,
  timingDetallado: null,
  contactoEventoNombre: null,
  contactoEventoTelefono: null,
  notasOperativas: null,
  briefingEquipo: null,
  fichaCerrada: false,
  fechaCierre: null,
  preEventoStatus: 'pendiente',
  ...over,
});

const reservaConFicha = (
  over: Partial<ReservaFichaOperativa> = {},
): ReservaFichaOperativa => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'reserva_confirmada',
  ficha: fichaVacia(),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta la tx única del guardado; el
// puerto `guardarCampos` devuelve la ficha RESULTANTE (para evaluar D-2 sobre el
// resultado del guardado, no solo el payload).
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosFicha {
  ficha: {
    guardarCampos: jest.Mock;
    transicionarPreEvento: jest.Mock;
    tocarFechaCierre: jest.Mock;
  };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (fichaResultante: FichaOperativa): ReposFake => ({
  ficha: {
    guardarCampos: jest.fn(async (_reservaId: string, campos: Partial<FichaOperativa>) => ({
      ...fichaResultante,
      ...campos,
    })),
    transicionarPreEvento: jest.fn(async () => undefined),
    tocarFechaCierre: jest.fn(async () => undefined),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoFichaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosFicha) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: { reserva?: ReservaFichaOperativa | null } = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaConFicha();
  const fichaBase = reserva?.ficha ?? fichaVacia();
  const repos = crearReposFake(fichaBase);
  const uow = crearUowFake(repos);
  const cargarReservaConFicha = jest.fn(async () => reserva);
  const deps: GuardarFichaOperativaDeps = {
    unidadDeTrabajo: uow,
    cargarReservaConFicha,
    clock: relojFijo,
  };
  return {
    useCase: new GuardarFichaOperativaUseCase(deps),
    repos,
    uow,
    cargarReservaConFicha,
    deps,
  };
};

const comando = (
  over: Partial<GuardarFichaOperativaComando> = {},
): GuardarFichaOperativaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  campos: { numInvitadosConfirmado: 85 },
  ...over,
});

// ===========================================================================
// 3.4 — Guardado PARCIAL: persiste SOLO el subconjunto de campos enviado.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — guardado parcial persiste solo el subconjunto (3.4)', () => {
  it('debe_persistir_solo_los_campos_enviados', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(
      comando({
        campos: {
          numInvitadosConfirmado: 85,
          timingDetallado: '18h llegada, 19h cena, 00h fin',
          contactoEventoNombre: 'María López',
          notasOperativas: 'Alergia a los frutos secos',
        },
      }),
    );

    expect(repos.ficha.guardarCampos).toHaveBeenCalledTimes(1);
    const [reservaId, campos] = repos.ficha.guardarCampos.mock.calls[0];
    expect(reservaId).toBe(RESERVA_ID);
    expect(campos).toEqual({
      numInvitadosConfirmado: 85,
      timingDetallado: '18h llegada, 19h cena, 00h fin',
      contactoEventoNombre: 'María López',
      notasOperativas: 'Alergia a los frutos secos',
    });
    // No se envían campos no incluidos en el payload.
    expect(campos).not.toHaveProperty('menuSeleccionado');
    expect(campos).not.toHaveProperty('briefingEquipo');
  });

  it('debe_orquestar_el_guardado_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.4 — AUDIT_LOG en cada guardado de campos.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — AUDIT_LOG del guardado (3.4)', () => {
  it('debe_registrar_AUDIT_LOG_del_guardado_de_la_ficha', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalled();
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.entidad).toBe('FICHA_OPERATIVA');
    expect(args.entidadId).toBe(RESERVA_ID);
  });
});

// ===========================================================================
// 3.4 — Primer guardado con DATOS dispara `pendiente → en_curso` (D-2) en la
//        misma tx. Se evalúa sobre el RESULTADO del guardado.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — primer guardado con datos dispara en_curso (3.4)', () => {
  it('debe_transicionar_pre_evento_status_a_en_curso_en_el_primer_guardado_con_datos', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'pendiente' }) }),
    });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 85 } }));

    expect(repos.ficha.transicionarPreEvento).toHaveBeenCalledTimes(1);
    const args = repos.ficha.transicionarPreEvento.mock.calls[0];
    expect(JSON.stringify(args)).toContain('en_curso');
  });

  it('debe_registrar_AUDIT_LOG_de_la_transicion_pendiente_a_en_curso', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'pendiente' }) }),
    });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 85 } }));

    // Se auditan al menos el guardado y la transición.
    const transiciones = repos.auditoria.registrar.mock.calls.filter((c) =>
      JSON.stringify(c[0]).includes('en_curso'),
    );
    expect(transiciones.length).toBeGreaterThanOrEqual(1);
  });

  it('no_debe_disparar_la_transicion_cuando_el_guardado_no_aporta_datos', async () => {
    // Ficha ya en pendiente; guardado que deja todo vacío (solo blancos/nulos).
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'pendiente' }) }),
    });

    await useCase.ejecutar(comando({ campos: { menuSeleccionado: '   ', notasOperativas: '' } }));

    expect(repos.ficha.transicionarPreEvento).not.toHaveBeenCalled();
  });

  it('no_debe_reevaluar_ni_re_transicionar_cuando_ya_esta_en_curso', async () => {
    // Idempotencia: guardados posteriores con la ficha ya en en_curso no repiten.
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'en_curso' }) }),
    });

    await useCase.ejecutar(comando({ campos: { menuSeleccionado: 'Menú degustación' } }));

    expect(repos.ficha.transicionarPreEvento).not.toHaveBeenCalled();
    expect(repos.ficha.guardarCampos).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.6 — Edición POST-CIERRE (D-4): persiste el cambio, actualiza
//        `fecha_cierre = now()`, `pre_evento_status` PERMANECE `cerrado` (no
//        reabre), AUDIT_LOG. La ficha es editable aun cerrada.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — edición post-cierre no reabre el estado (3.6)', () => {
  const fichaCerrada = () =>
    reservaConFicha({
      ficha: fichaVacia({
        numInvitadosConfirmado: 80,
        fichaCerrada: true,
        fechaCierre: CIERRE_PREVIO,
        preEventoStatus: 'cerrado',
      }),
    });

  it('debe_persistir_el_cambio_en_una_ficha_cerrada', async () => {
    const { useCase, repos } = montar({ reserva: fichaCerrada() });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 90 } }));

    expect(repos.ficha.guardarCampos).toHaveBeenCalledTimes(1);
    const [, campos] = repos.ficha.guardarCampos.mock.calls[0];
    expect(campos.numInvitadosConfirmado).toBe(90);
  });

  it('debe_actualizar_fecha_cierre_a_now_en_la_edicion_post_cierre', async () => {
    const { useCase, repos } = montar({ reserva: fichaCerrada() });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 90 } }));

    expect(repos.ficha.tocarFechaCierre).toHaveBeenCalledTimes(1);
    const args = repos.ficha.tocarFechaCierre.mock.calls[0];
    expect(JSON.stringify(args)).toContain(AHORA.toISOString());
  });

  it('no_debe_reabrir_el_estado_no_transiciona_desde_cerrado', async () => {
    const { useCase, repos } = montar({ reserva: fichaCerrada() });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 90 } }));

    // La edición post-cierre NO llama a transicionarPreEvento (cerrado es estable).
    expect(repos.ficha.transicionarPreEvento).not.toHaveBeenCalled();
  });

  it('debe_registrar_AUDIT_LOG_de_la_edicion_post_cierre', async () => {
    const { useCase, repos } = montar({ reserva: fichaCerrada() });

    await useCase.ejecutar(comando({ campos: { numInvitadosConfirmado: 90 } }));

    expect(repos.auditoria.registrar).toHaveBeenCalled();
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.entidad).toBe('FICHA_OPERATIVA');
  });
});

// ===========================================================================
// 3.4 — Guarda de acceso (D-3): estado anterior a reserva_confirmada →
//        FichaNoDisponibleError SIN mutar; no se abre la tx ni se persiste.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — guarda de acceso por estado (3.4)', () => {
  const anteriores: ReadonlyArray<EstadoReservaFicha> = ['consulta', 'pre_reserva'];

  it.each(anteriores)(
    'debe_lanzar_FichaNoDisponible_cuando_la_reserva_esta_en_%s_sin_efectos',
    async (estado) => {
      const { useCase, repos, uow } = montar({
        reserva: reservaConFicha({ estado, ficha: null }),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(FichaNoDisponibleError);
      await expect(promesa).rejects.toMatchObject({ code: 'ficha_no_disponible' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(repos.ficha.guardarCampos).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 3.4 — Aislamiento tenant / RLS: RESERVA inexistente/cross-tenant → 404 sin efectos.
// ===========================================================================

describe('GuardarFichaOperativaUseCase — aislamiento tenant / RLS (3.4)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, uow } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(repos.ficha.guardarCampos).not.toHaveBeenCalled();
  });
});
