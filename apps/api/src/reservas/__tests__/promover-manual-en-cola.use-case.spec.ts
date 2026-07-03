/**
 * TESTS DE APLICACIÓN del caso de uso `PromoverManualEnColaService`
 * (US-019 / UC-12 FA manual, actor Gestor) — fase TDD RED. tasks.md Fase 3: 3.2
 * (happy path promover P intermedia, FA-01 promover P=1, FA-02 bloqueante con TTL
 * vencido no barrida se expira igual, FA-03 cola de 1 queda vacía, FA-05 consulta ya
 * no en 2.d = rechazo, inconsistencia sin FECHA_BLOQUEADA = rechazo, confirmación
 * ausente = rechazo, carrera perdida = 409/aborta).
 *
 * Trazabilidad: US-019, spec-delta `consultas` (Requirements: promoción manual de
 * consulta arbitraria; expiración forzosa de la bloqueante a 2x; re-asignación atómica
 * de FECHA_BLOQUEADA a la promovida; reordenación por cierre de hueco; all-or-nothing
 * sin estado intermedio; guarda "solo 2.d es promovible" FA-05; guarda "exige
 * FECHA_BLOQUEADA activa"; AUDIT_LOG por RESERVA con `origen: promocion_manual` + el
 * `usuario_id` del Gestor; coordinación anti-doble-promoción RC-A → 409); design.md
 * §D-2 (dominio puro + caso de uso de aplicación orquestando UNA transacción), §D-3
 * (orden: expirar bloqueante → re-asignar FECHA_BLOQUEADA → promover → reordenar →
 * auditar), §D-4 (guarda "ya promovida" bajo `SELECT … FOR UPDATE` sobre
 * FECHA_BLOQUEADA; FIFO + gana el primer lock → 409, sin cesión al Gestor), §D-7 (RLS
 * por tenant + `usuario_id` del JWT). skill `tdd-core`.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de uso
 * contra un DOBLE del puerto `PromocionManualColaUoWPort` (in-memory), SIN tocar Prisma
 * ni la BD. El puerto encapsula la TRANSACCIÓN atómica (lock sobre FECHA_BLOQUEADA +
 * guardas + expiración forzosa + promoción + re-asignación de FECHA_BLOQUEADA +
 * reordenación por cierre de hueco + auditoría). El caso de uso ORQUESTA: recibe
 * `{ tenantId, usuarioId, reservaId, confirmado }`, aplica la guarda de confirmación
 * (defensa en servidor D-1), invoca la UoW y traduce su desenlace a
 * resultado/errores de dominio. El efecto REAL en BD se verifica en integración.
 *
 * RED: aún NO existe `application/promover-manual-en-cola.service.ts` ni sus
 * puertos/tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  PromoverManualEnColaService,
  PromocionManualConfirmacionError,
  PromocionManualConsultaNoEnColaError,
  PromocionManualReservaNoEncontradaError,
  PromocionManualSinBloqueoError,
  PromocionManualCarreraPerdidaError,
  type PromocionManualColaUoWPort,
  type PromoverManualComando,
  type ResultadoPromocionManual,
} from '../application/promover-manual-en-cola.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000b2';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ELEGIDA = 'R3';

const comando = (over: Partial<PromoverManualComando> = {}): PromoverManualComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ELEGIDA,
  confirmado: true,
  ...over,
});

const resultadoOk = (over: Partial<ResultadoPromocionManual> = {}): ResultadoPromocionManual => ({
  reservaPromovidaId: RESERVA_ELEGIDA,
  bloqueanteExpiradaId: 'R1',
  fechaReAsignada: true,
  reordenadas: 1,
  auditadas: 3, // R1 expirada + R3 promovida + R2 reordenada.
  ...over,
});

type UoWFake = PromocionManualColaUoWPort & { promover: jest.Mock };

/**
 * Doble de la UoW de promoción manual. Por defecto promueve con éxito (expira R1,
 * promueve R3, reordena R2). `desenlace` permite mapear el resultado o forzar el
 * abort de la guarda mediante el error de dominio correspondiente.
 */
const crearUoWFake = (
  desenlace?: ResultadoPromocionManual | Error,
): UoWFake => ({
  promover: jest.fn(async (_c: PromoverManualComando): Promise<ResultadoPromocionManual> => {
    if (desenlace instanceof Error) {
      throw desenlace;
    }
    return desenlace ?? resultadoOk();
  }),
});

const montar = (desenlace?: ResultadoPromocionManual | Error) => {
  const uow = crearUoWFake(desenlace);
  const servicio = new PromoverManualEnColaService({ uow });
  return { servicio, uow };
};

// ===========================================================================
// Happy path — promoción manual de una posición INTERMEDIA (R3): la UoW expira la
// bloqueante R1, promueve R3, re-asigna FECHA_BLOQUEADA y reordena R2. El caso de uso
// propaga tenant/usuario del JWT y devuelve el desenlace.
//   spec-delta: "El Gestor promueve una consulta de la cola que no es la primera".
// ===========================================================================

describe('PromoverManualEnColaService — happy path promover posición intermedia', () => {
  it('debe_delegar_en_la_uow_con_tenant_usuario_y_reserva_elegida', async () => {
    const { servicio, uow } = montar();

    await servicio.ejecutar(comando());

    expect(uow.promover).toHaveBeenCalledTimes(1);
    expect(uow.promover).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: RESERVA_ELEGIDA,
      }),
    );
  });

  it('debe_reportar_la_bloqueante_expirada_la_promovida_y_las_reordenadas', async () => {
    const { servicio } = montar();

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.reservaPromovidaId).toBe(RESERVA_ELEGIDA);
    expect(resultado.bloqueanteExpiradaId).toBe('R1');
    expect(resultado.fechaReAsignada).toBe(true);
    expect(resultado.reordenadas).toBe(1);
    expect(resultado.auditadas).toBe(3);
  });
});

// ===========================================================================
// FA-01 — promover la PRIMERA (P=1): promueve sin dejar a nadie descolocado; el
// desenlace refleja los restantes reordenados.
// ===========================================================================

describe('PromoverManualEnColaService — FA-01 promover P=1', () => {
  it('debe_promover_la_primera_y_reportar_los_reordenamientos', async () => {
    const { servicio } = montar(
      resultadoOk({ reservaPromovidaId: 'R2', reordenadas: 1, auditadas: 3 }),
    );

    const resultado = await servicio.ejecutar(comando({ reservaId: 'R2' }));

    expect(resultado.reservaPromovidaId).toBe('R2');
    expect(resultado.reordenadas).toBe(1);
  });
});

// ===========================================================================
// FA-02 — bloqueante con TTL YA VENCIDO pero no barrida: la UoW la detecta y la expira
// igualmente a 2x como parte de la promoción (la guarda de expiración forzosa admite
// TTL vigente O vencido). El caso de uso lo reporta como promoción efectiva.
//   spec-delta: "Bloqueante con TTL ya vencido pero no barrida — se expira igualmente".
// ===========================================================================

describe('PromoverManualEnColaService — FA-02 bloqueante con TTL vencido no barrida', () => {
  it('debe_promover_expirando_la_bloqueante_vencida_igual', async () => {
    const { servicio } = montar(resultadoOk({ bloqueanteExpiradaId: 'R1' }));

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.bloqueanteExpiradaId).toBe('R1');
    expect(resultado.reservaPromovidaId).toBe(RESERVA_ELEGIDA);
  });
});

// ===========================================================================
// FA-03 — cola de UN elemento: promover el único deja la cola VACÍA (sin
// reordenamientos), la bloqueante expirada y la fecha re-asignada.
//   spec-delta: "Cola de un único elemento queda vacía tras la promoción (FA-03)".
// ===========================================================================

describe('PromoverManualEnColaService — FA-03 cola de un elemento queda vacía', () => {
  it('debe_promover_sin_reordenar_cuando_la_cola_tenia_un_solo_elemento', async () => {
    const { servicio } = montar(
      resultadoOk({ reservaPromovidaId: 'R2', reordenadas: 0, auditadas: 2 }),
    );

    const resultado = await servicio.ejecutar(comando({ reservaId: 'R2' }));

    expect(resultado.reordenadas).toBe(0);
    expect(resultado.fechaReAsignada).toBe(true);
  });
});

// ===========================================================================
// Confirmación EXPLÍCITA (D-1, defensa en servidor): sin `confirmado: true` el caso de
// uso rechaza ANTES de tocar la UoW (no abre transacción). Mapea a 422 en el controller.
//   spec-delta / contrato: "Confirmación ausente: la promoción manual llegó sin
//   confirmado: true → 422".
// ===========================================================================

describe('PromoverManualEnColaService — exige confirmación explícita (D-1)', () => {
  it('debe_rechazar_sin_tocar_la_uow_cuando_confirmado_es_false', async () => {
    const { servicio, uow } = montar();

    await expect(servicio.ejecutar(comando({ confirmado: false }))).rejects.toBeInstanceOf(
      PromocionManualConfirmacionError,
    );
    expect(uow.promover).not.toHaveBeenCalled();
  });

  it('debe_rechazar_sin_tocar_la_uow_cuando_falta_confirmado', async () => {
    const { servicio, uow } = montar();
    const sinConfirmar = { tenantId: TENANT, usuarioId: GESTOR, reservaId: RESERVA_ELEGIDA } as PromoverManualComando;

    await expect(servicio.ejecutar(sinConfirmar)).rejects.toBeInstanceOf(
      PromocionManualConfirmacionError,
    );
    expect(uow.promover).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// FA-05 — consulta ya no en 2.d: la UoW re-evalúa la guarda de origen bajo el lock y,
// si la elegida no está en `2.d`, lanza el error de dominio; el caso de uso lo propaga
// (el controller lo mapea a 422 "La consulta seleccionada ya no está en cola").
//   spec-delta: "Promover una consulta que ya no está en 2.d se rechaza sin efectos".
// ===========================================================================

describe('PromoverManualEnColaService — FA-05 consulta ya no en 2.d', () => {
  it('debe_propagar_el_error_cuando_la_elegida_ya_no_esta_en_cola', async () => {
    const { servicio } = montar(
      new PromocionManualConsultaNoEnColaError('La consulta seleccionada ya no está en cola'),
    );

    await expect(servicio.ejecutar(comando())).rejects.toBeInstanceOf(
      PromocionManualConsultaNoEnColaError,
    );
  });

  // H-1 (code-review US-019): FA-05 "existe pero YA NO está en 2.d" es un error DISTINTO
  // de "no resoluble bajo RLS". El de FA-05 NO debe ser instancia del de "no encontrada":
  // así el controller lo mapea a 422 (guarda de negocio) y NUNCA a 404. Fija la jerarquía
  // de errores para que ambos códigos no colapsen en uno solo.
  //   contrato op `promoverConsultaCola`: 422 = FA-05 (existe, no en 2d); 404 = RLS.
  it('debe_distinguir_FA05_no_en_cola_de_reserva_no_encontrada', async () => {
    const { servicio } = montar(
      new PromocionManualConsultaNoEnColaError('La consulta seleccionada ya no está en cola'),
    );

    await expect(servicio.ejecutar(comando())).rejects.not.toBeInstanceOf(
      PromocionManualReservaNoEncontradaError,
    );
  });
});

// ===========================================================================
// H-1 (code-review US-019) — RESERVA no resoluble bajo RLS (inexistente o de OTRO
// tenant): es un error de dominio PROPIO y distinto de FA-05. La UoW lo lanza cuando el
// `reservaId` no existe para el tenant del JWT; el caso de uso lo propaga tal cual (el
// controller lo mapea a 404, no a 422).
//   contrato op `promoverConsultaCola`: 404 "Reserva {id} inexistente o de otro tenant (RLS)".
// ===========================================================================

describe('PromoverManualEnColaService — H-1 reserva no encontrada bajo RLS (404)', () => {
  it('debe_propagar_reserva_no_encontrada_cuando_no_es_resoluble_bajo_rls', async () => {
    const { servicio } = montar(
      new PromocionManualReservaNoEncontradaError('La reserva indicada no existe'),
    );

    await expect(servicio.ejecutar(comando())).rejects.toBeInstanceOf(
      PromocionManualReservaNoEncontradaError,
    );
  });

  it('reserva_no_encontrada_no_debe_ser_instancia_del_error_de_FA05_no_en_cola', async () => {
    const { servicio } = montar(
      new PromocionManualReservaNoEncontradaError('La reserva indicada no existe'),
    );

    // Blindaje inverso de la jerarquía: "no encontrada" (404) NO puede colapsar en el
    // error de FA-05 (422), o el controller devolvería el código equivocado.
    await expect(servicio.ejecutar(comando())).rejects.not.toBeInstanceOf(
      PromocionManualConsultaNoEnColaError,
    );
  });
});

// ===========================================================================
// Inconsistencia — sin FECHA_BLOQUEADA activa para la fecha de la consulta elegida:
// la UoW lo detecta y lanza; el caso de uso lo propaga (el controller lo mapea a 409
// inconsistencia de bloqueo).
//   spec-delta: "Sin FECHA_BLOQUEADA para la fecha — la promoción se rechaza".
// ===========================================================================

describe('PromoverManualEnColaService — exige FECHA_BLOQUEADA activa', () => {
  it('debe_propagar_el_error_cuando_no_existe_bloqueo_activo_para_la_fecha', async () => {
    const { servicio } = montar(
      new PromocionManualSinBloqueoError('No existe FECHA_BLOQUEADA activa para la fecha'),
    );

    await expect(servicio.ejecutar(comando())).rejects.toBeInstanceOf(
      PromocionManualSinBloqueoError,
    );
  });
});

// ===========================================================================
// Carrera perdida (RC-A/RC-B, D-4): la guarda "ya promovida" detecta bajo el lock que
// el barrido automático (US-018) u otro Gestor ya actualizó la cola; la UoW aborta y
// lanza el error de carrera; el caso de uso lo propaga (el controller lo mapea a 409
// "La cola ya fue actualizada automáticamente, por favor recarga la vista").
//   spec-delta: "si la que falla es la acción del Gestor, recibe 'La cola ya fue
//   actualizada automáticamente…'".
// ===========================================================================

describe('PromoverManualEnColaService — carrera perdida (D-4)', () => {
  it('debe_propagar_el_error_de_carrera_cuando_la_guarda_ya_promovida_aborta', async () => {
    const { servicio } = montar(
      new PromocionManualCarreraPerdidaError(
        'La cola ya fue actualizada automáticamente, por favor recarga la vista',
      ),
    );

    await expect(servicio.ejecutar(comando())).rejects.toBeInstanceOf(
      PromocionManualCarreraPerdidaError,
    );
  });
});

// ===========================================================================
// Multi-tenancy (D-7): el caso de uso propaga SIEMPRE el tenant y el usuario del
// comando (derivados del JWT), nunca de otro sitio.
// ===========================================================================

describe('PromoverManualEnColaService — RLS por tenant + usuario del JWT (D-7)', () => {
  it('debe_pasar_a_la_uow_el_tenant_y_usuario_recibidos_en_el_comando', async () => {
    const { servicio, uow } = montar();

    await servicio.ejecutar(comando({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }));

    expect(uow.promover).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }),
    );
  });
});
