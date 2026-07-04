/**
 * TESTS del caso de uso `CerrarFichaOperativaUseCase` (US-025 / UC-20) — fase TDD RED.
 * tasks.md Fase 3: 3.5 (cierre NO bloqueado por campos vacíos: `ficha_cerrada = true`,
 * `fecha_cierre = now()`, `pre_evento_status: en_curso → cerrado`, `avisosCamposVacios`
 * como aviso informativo —NO error—, AUDIT_LOG).
 *
 * Trazabilidad: US-025; spec-delta `ficha-operativa` (Requirements "Cierre de la
 * ficha no bloqueado por campos vacíos", "Guarda de acceso por estado de la RESERVA",
 * "pre_evento_status = cerrado como precondición de evento_en_curso"); design.md §D-1
 * (`en_curso → cerrado`), §D-3 (guarda de acceso), §D-6 (cierre no bloqueante + aviso
 * informativo). Contrato congelado:
 *   - `POST /reservas/{id}/ficha-operativa/cerrar` → 200 `CerrarFichaOperativaResponse`
 *     (FichaOperativa + `avisosCamposVacios: string[]`) | 409 `ficha_no_disponible` | 404.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory) en una única unidad
 * de trabajo, sin tocar Prisma (hexagonal, hook `no-infra-in-domain`). Fija: el cierre
 * fija `ficha_cerrada = true`, `fecha_cierre = now()` y transiciona `en_curso →
 * cerrado`; NUNCA falla por campos vacíos (devuelve `avisosCamposVacios` con los
 * nombres camelCase de los campos de contenido vacíos, lista vacía si están todos
 * rellenos); audita la transición; y la guarda de estado/tenant se aplica ANTES.
 *
 * RED: aún NO existe `ficha-evento/application/cerrar-ficha-operativa.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  CerrarFichaOperativaUseCase,
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  type CerrarFichaOperativaDeps,
  type CerrarFichaOperativaComando,
  type ReservaFichaOperativa,
  type FichaOperativa,
  type RepositoriosFicha,
  type UnidadDeTrabajoFichaPort,
  type ClockPort,
  type EstadoReservaFicha,
} from '../application/cerrar-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-conf';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
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
  preEventoStatus: 'en_curso',
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

// Ficha con TODOS los campos de contenido rellenos (cierre sin avisos).
const fichaCompleta = (): FichaOperativa =>
  fichaVacia({
    numInvitadosConfirmado: 85,
    menuSeleccionado: 'Menú degustación',
    timingDetallado: '18h llegada, 19h cena',
    contactoEventoNombre: 'María López',
    contactoEventoTelefono: '600123123',
    notasOperativas: 'Alergia a los frutos secos',
    briefingEquipo: 'Turno de 8 camareros',
    preEventoStatus: 'en_curso',
  });

// ---------------------------------------------------------------------------
// Repositorios + UoW fake.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosFicha {
  ficha: { cerrar: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (fichaBase: FichaOperativa): ReposFake => ({
  ficha: {
    cerrar: jest.fn(async (_reservaId: string, datos: Record<string, unknown>) => ({
      ...fichaBase,
      ...datos,
    })),
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
  const deps: CerrarFichaOperativaDeps = {
    unidadDeTrabajo: uow,
    cargarReservaConFicha,
    clock: relojFijo,
  };
  return {
    useCase: new CerrarFichaOperativaUseCase(deps),
    repos,
    uow,
    cargarReservaConFicha,
    deps,
  };
};

const comando = (
  over: Partial<CerrarFichaOperativaComando> = {},
): CerrarFichaOperativaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.5 — Cierre con datos completos: `ficha_cerrada = true`, `fecha_cierre = now()`,
//        `pre_evento_status = cerrado`, avisos vacíos.
// ===========================================================================

describe('CerrarFichaOperativaUseCase — cierre con datos completos (3.5)', () => {
  it('debe_fijar_ficha_cerrada_true_fecha_cierre_now_y_pre_evento_cerrado', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaCompleta() }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(repos.ficha.cerrar).toHaveBeenCalledTimes(1);
    const [reservaId, datos] = repos.ficha.cerrar.mock.calls[0];
    expect(reservaId).toBe(RESERVA_ID);
    expect(datos.fichaCerrada).toBe(true);
    expect(datos.fechaCierre).toEqual(AHORA);
    expect(datos.preEventoStatus).toBe('cerrado');

    expect(resultado.fichaCerrada).toBe(true);
    expect(resultado.preEventoStatus).toBe('cerrado');
  });

  it('debe_devolver_avisosCamposVacios_vacio_cuando_todos_los_campos_estan_rellenos', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({ ficha: fichaCompleta() }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.avisosCamposVacios).toEqual([]);
  });

  it('debe_orquestar_el_cierre_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar({ reserva: reservaConFicha({ ficha: fichaCompleta() }) });

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.5 — Cierre NO bloqueado por campos vacíos (D-6): con campos opcionales vacíos
//        el cierre SE PERMITE (no lanza) y devuelve `avisosCamposVacios` con los
//        nombres camelCase de los campos vacíos; NO es un error ni un 4xx.
// ===========================================================================

describe('CerrarFichaOperativaUseCase — cierre no bloqueante con avisosCamposVacios (3.5)', () => {
  it('debe_permitir_el_cierre_y_transicionar_a_cerrado_aunque_falten_campos', async () => {
    // Solo numInvitadosConfirmado relleno; menu y briefing (y el resto) vacíos.
    const { useCase, repos } = montar({
      reserva: reservaConFicha({
        ficha: fichaVacia({ numInvitadosConfirmado: 85, preEventoStatus: 'en_curso' }),
      }),
    });

    const resultado = await useCase.ejecutar(comando());

    // NO lanza (cierre permitido) y transiciona a cerrado.
    expect(repos.ficha.cerrar).toHaveBeenCalledTimes(1);
    expect(resultado.preEventoStatus).toBe('cerrado');
    expect(resultado.fichaCerrada).toBe(true);
  });

  it('debe_listar_los_campos_vacios_en_camelCase_en_avisosCamposVacios', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({
        ficha: fichaVacia({ numInvitadosConfirmado: 85, preEventoStatus: 'en_curso' }),
      }),
    });

    const resultado = await useCase.ejecutar(comando());

    // Todos menos numInvitadosConfirmado están vacíos.
    expect(resultado.avisosCamposVacios).toEqual(
      expect.arrayContaining([
        'menuSeleccionado',
        'timingDetallado',
        'contactoEventoNombre',
        'contactoEventoTelefono',
        'notasOperativas',
        'briefingEquipo',
      ]),
    );
    // numInvitadosConfirmado está relleno → NO aparece.
    expect(resultado.avisosCamposVacios).not.toContain('numInvitadosConfirmado');
  });

  it('debe_tratar_un_string_en_blanco_como_campo_vacio_en_los_avisos', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({
        ficha: fichaVacia({
          numInvitadosConfirmado: 85,
          menuSeleccionado: '   ', // solo espacios → vacío
          preEventoStatus: 'en_curso',
        }),
      }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.avisosCamposVacios).toContain('menuSeleccionado');
  });

  it('no_debe_lanzar_ningun_error_por_campos_vacios_al_cerrar', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'en_curso' }) }),
    });

    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();
  });
});

// ===========================================================================
// 3.5 — AUDIT_LOG de la transición `en_curso → cerrado`.
// ===========================================================================

describe('CerrarFichaOperativaUseCase — AUDIT_LOG del cierre (3.5)', () => {
  it('debe_registrar_AUDIT_LOG_de_la_transicion_en_curso_a_cerrado', async () => {
    const { useCase, repos } = montar({
      reserva: reservaConFicha({ ficha: fichaCompleta() }),
    });

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalled();
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.entidad).toBe('FICHA_OPERATIVA');
    expect(args.entidadId).toBe(RESERVA_ID);
    expect(JSON.stringify(args)).toContain('cerrado');
  });
});

// ===========================================================================
// 3.5 — Guarda de acceso (D-3): estado anterior a reserva_confirmada →
//        FichaNoDisponibleError SIN cerrar; no se abre la tx.
// ===========================================================================

describe('CerrarFichaOperativaUseCase — guarda de acceso por estado (3.5)', () => {
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
      expect(repos.ficha.cerrar).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 3.5 — Aislamiento tenant / RLS: RESERVA inexistente/cross-tenant → 404 sin efectos.
// ===========================================================================

describe('CerrarFichaOperativaUseCase — aislamiento tenant / RLS (3.5)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, uow } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(repos.ficha.cerrar).not.toHaveBeenCalled();
  });
});
