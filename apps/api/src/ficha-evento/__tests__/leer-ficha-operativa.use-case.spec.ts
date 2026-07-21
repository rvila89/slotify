/**
 * TESTS del caso de uso `LeerFichaOperativaUseCase` (US-025 / UC-20) — fase TDD RED.
 * tasks.md Fase 3: 3.3 (guarda de acceso por `RESERVA.estado` + aislamiento tenant).
 *
 * Trazabilidad: US-025; spec-delta `ficha-operativa` (Requirements "Guarda de acceso
 * a la ficha operativa por estado de la RESERVA" y "Lectura de la ficha operativa de
 * una RESERVA confirmada"); design.md §D-3 (acceso ⇔ `RESERVA.estado ∈
 * {reserva_confirmada, evento_en_curso, post_evento}`; estado anterior → "no
 * disponible" SIN exponer entidad; otra tenant → no accesible). Contrato congelado:
 *   - `GET /reservas/{id}/ficha-operativa` → 200 `FichaOperativa` |
 *     409 `FichaOperativaNoDisponibleError` (`code=ficha_no_disponible`) | 404.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Verifica que LEER no muta ningún estado
 * (`pre_evento_status` intacto), que la guarda de acceso admite los tres estados
 * confirmados-o-posteriores, que un estado anterior devuelve el error de dominio
 * "no disponible" (mapeado a 409 `ficha_no_disponible` en el controlador) SIN exponer
 * la entidad, que una RESERVA inexistente/cross-tenant no se expone y que el
 * `tenant_id` del comando se propaga a los puertos (RLS).
 *
 * RED: aún NO existe `ficha-evento/application/leer-ficha-operativa.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  LeerFichaOperativaUseCase,
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  type LeerFichaOperativaDeps,
  type LeerFichaOperativaComando,
  type ReservaFichaOperativa,
  type FichaOperativa,
  type EstadoReservaFicha,
} from '../application/leer-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-conf';

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA confirmada con su FICHA_OPERATIVA vacía asociada.
// ---------------------------------------------------------------------------

const fichaVacia = (over: Partial<FichaOperativa> = {}): FichaOperativa => ({
  idFicha: 'ficha-1',
  reservaId: RESERVA_ID,
  numInvitadosConfirmado: null,
  contactoEventoNombre: null,
  contactoEventoTelefono: null,
  contactoEventoCorreo: null,
  horaLlegada: null,
  duracion: null,
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

const montar = (opciones: { reserva?: ReservaFichaOperativa | null } = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaConFicha();
  const cargarReservaConFicha = jest.fn(async () => reserva);
  const deps: LeerFichaOperativaDeps = { cargarReservaConFicha };
  return { useCase: new LeerFichaOperativaUseCase(deps), cargarReservaConFicha, deps };
};

const comando = (
  over: Partial<LeerFichaOperativaComando> = {},
): LeerFichaOperativaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.3 — Guarda de acceso: los estados accesibles son
//        {reserva_confirmada, evento_en_curso, post_evento}: devuelven la ficha.
// ===========================================================================

describe('LeerFichaOperativaUseCase — estados accesibles exponen la ficha (3.3)', () => {
  const accesibles: ReadonlyArray<EstadoReservaFicha> = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
  ];

  it.each(accesibles)(
    'debe_devolver_la_ficha_cuando_la_reserva_esta_en_%s',
    async (estado) => {
      const { useCase } = montar({ reserva: reservaConFicha({ estado }) });

      const ficha = await useCase.ejecutar(comando());

      expect(ficha.reservaId).toBe(RESERVA_ID);
      expect(ficha.fichaCerrada).toBe(false);
      expect(ficha.fechaCierre).toBeNull();
      expect(ficha.preEventoStatus).toBe('pendiente');
    },
  );

  it('debe_devolver_todos_los_campos_de_contenido_de_una_ficha_con_datos', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({
        ficha: fichaVacia({
          numInvitadosConfirmado: 85,
          notasOperativas: 'Alergia a los frutos secos',
          preEventoStatus: 'en_curso',
        }),
      }),
    });

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.numInvitadosConfirmado).toBe(85);
    expect(ficha.notasOperativas).toBe('Alergia a los frutos secos');
    expect(ficha.preEventoStatus).toBe('en_curso');
  });

  it('debe_exponer_los_nuevos_campos_operativos_y_no_los_eliminados', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({
        ficha: fichaVacia({
          contactoEventoCorreo: 'maria@example.com',
          horaLlegada: '18:00',
          duracion: '4h',
        }),
      }),
    });

    const ficha = await useCase.ejecutar(comando());

    // Nuevos campos del contrato.
    expect(ficha.contactoEventoCorreo).toBe('maria@example.com');
    expect(ficha.horaLlegada).toBe('18:00');
    expect(ficha.duracion).toBe('4h');
    // Campos eliminados del contrato: ya no forman parte de la respuesta.
    expect(ficha).not.toHaveProperty('menuSeleccionado');
    expect(ficha).not.toHaveProperty('timingDetallado');
  });
});

// ===========================================================================
// 3.3 — LEER no muta: `pre_evento_status` permanece `pendiente` (no dispara la
//        transición) y no se invoca ningún puerto de escritura (solo carga).
// ===========================================================================

describe('LeerFichaOperativaUseCase — leer no muta ningún estado (3.3)', () => {
  it('debe_devolver_pre_evento_status_pendiente_sin_dispararlo_a_en_curso', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({ ficha: fichaVacia({ preEventoStatus: 'pendiente' }) }),
    });

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.preEventoStatus).toBe('pendiente');
  });
});

// ===========================================================================
// 3.3 — Guarda de acceso: un estado ANTERIOR a `reserva_confirmada`
//        (`consulta`, `pre_reserva`) → FichaNoDisponibleError SIN exponer entidad
//        (a nivel controlador: 409 `ficha_no_disponible`). No se crea nada.
// ===========================================================================

describe('LeerFichaOperativaUseCase — estado anterior devuelve "no disponible" (3.3)', () => {
  const anteriores: ReadonlyArray<EstadoReservaFicha> = ['consulta', 'pre_reserva'];

  it.each(anteriores)(
    'debe_lanzar_FichaNoDisponible_cuando_la_reserva_esta_en_%s_sin_exponer_entidad',
    async (estado) => {
      // La ficha aún no existe (se crea al confirmar, US-021): ficha = null.
      const { useCase } = montar({
        reserva: reservaConFicha({ estado, ficha: null }),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(FichaNoDisponibleError);
      await expect(promesa).rejects.toMatchObject({ code: 'ficha_no_disponible' });
    },
  );

  it('debe_exponer_el_mensaje_contextual_de_ficha_no_disponible', async () => {
    const { useCase } = montar({
      reserva: reservaConFicha({ estado: 'pre_reserva', ficha: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toMatchObject({
      code: 'ficha_no_disponible',
      message: expect.stringContaining('confirmada'),
    });
  });
});

// ===========================================================================
// 3.3 — Aislamiento tenant / RLS: RESERVA inexistente para el tenant (o de otro
//        tenant) → ReservaNoEncontradaError (404), no se expone la ficha ajena.
//        El `tenant_id` del comando se propaga al puerto de carga.
// ===========================================================================

describe('LeerFichaOperativaUseCase — aislamiento tenant / RLS (3.3)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
  });

  it('debe_propagar_el_tenant_id_del_comando_al_puerto_de_carga_para_RLS', async () => {
    const { useCase, cargarReservaConFicha } = montar();

    await useCase.ejecutar(comando({ tenantId: TENANT }));

    expect(cargarReservaConFicha).toHaveBeenCalledTimes(1);
    const args = cargarReservaConFicha.mock.calls[0];
    // El primer argumento (o un objeto con tenantId) transporta el tenant del JWT.
    expect(JSON.stringify(args)).toContain(TENANT);
    expect(JSON.stringify(args)).toContain(RESERVA_ID);
  });

  it('no_debe_exponer_la_ficha_de_una_reserva_de_otro_tenant', async () => {
    // El puerto, filtrado por tenant, no la encuentra para OTRO_TENANT → 404.
    const { useCase } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
  });
});
