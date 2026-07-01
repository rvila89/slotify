/**
 * TESTS DE APLICACIÓN del caso de uso `PromoverPrimeroEnColaService`
 * (US-018 / UC-12, A15, actor Sistema) — fase TDD RED. tasks.md Fase 3: 3.2
 * (happy path, FA-01 cola de 1, FA-02 sin cola = no-op, FA-03 >2 reordena,
 * FA-04 idempotencia guarda "ya promovida") y 3.4 (anomalía no contigua).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirements: promoción FIFO
 * 2d→2b; re-creación atómica del bloqueo blando vía `bloquearFecha()`; reordenación
 * FIFO del resto; idempotencia guarda "ya promovida"; anomalía no contigua;
 * AUDIT_LOG por RESERVA; notificación = alerta interna al gestor SIN email);
 * design.md §D-2 (dominio puro + caso de uso de aplicación), §D-3 (guarda "ya
 * promovida" dentro de la TX tras `SELECT … FOR UPDATE`), §D-5 (alerta interna al
 * gestor, sin invocar comunicaciones/US-045), §D-7 (RLS por tenant de la fecha).
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de
 * uso contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la BD. El puerto
 * `PromocionColaUoWPort` encapsula la TRANSACCIÓN atómica: `SELECT … FOR UPDATE` de
 * `FECHA_BLOQUEADA`, guarda "ya promovida", lectura de cola bajo lock, aplicación del
 * plan de dominio (mutar promovida + re-bloqueo vía `bloquearFecha()` + reordenar
 * restantes), auditoría por RESERVA y registro de la alerta interna al gestor. El
 * caso de uso ORQUESTA: recibe `{ tenantId, fecha }` (firma del seam), invoca la UoW
 * y devuelve el desenlace. La reordenación/el re-bloqueo REALES se verifican en
 * integración; aquí se verifica el contrato del caso de uso contra el puerto.
 *
 * RED: aún NO existe `application/promover-primero-en-cola.service.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  PromoverPrimeroEnColaService,
  type PromocionColaUoWPort,
  type PromoverPrimeroEnColaComando,
  type ResultadoPromocion,
} from '../application/promover-primero-en-cola.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000b2';
const FECHA = new Date('2026-09-12T00:00:00.000Z');

const comando = (over: Partial<PromoverPrimeroEnColaComando> = {}): PromoverPrimeroEnColaComando => ({
  tenantId: TENANT,
  fecha: FECHA,
  ...over,
});

type UoWFake = PromocionColaUoWPort & { promover: jest.Mock };

/**
 * Doble de la UoW de promoción. Por defecto promueve con éxito a R2 (2b), re-bloquea
 * la fecha y deja constancia de la alerta interna. `resultado` permite mapear el
 * desenlace (no-op por guarda, sin cola, anomalía, promoción con reordenamientos…).
 */
const crearUoWFake = (
  resultado?: ResultadoPromocion | 'lanza',
): UoWFake => ({
  promover: jest.fn(async (_c: PromoverPrimeroEnColaComando): Promise<ResultadoPromocion> => {
    if (resultado === 'lanza') {
      throw new Error('fallo simulado de promoción');
    }
    return (
      resultado ?? {
        promovida: true,
        reservaPromovidaId: 'R2',
        fechaReBloqueada: true,
        reordenadas: 0,
        alertaInternaRegistrada: true,
        anomalia: false,
      }
    );
  }),
});

const montar = (resultado?: ResultadoPromocion | 'lanza') => {
  const uow = crearUoWFake(resultado);
  const servicio = new PromoverPrimeroEnColaService({ uow });
  return { servicio, uow };
};

// ===========================================================================
// Happy path — promoción efectiva de R2 a 2b, fecha re-bloqueada, alerta interna.
//   spec-delta: "Liberada la fecha, el primero en cola es promovido a 2.b".
// ===========================================================================

describe('PromoverPrimeroEnColaService — happy path 2d→2b', () => {
  it('debe_delegar_en_la_uow_con_el_tenant_y_la_fecha_del_seam', async () => {
    const { servicio, uow } = montar();

    await servicio.ejecutar(comando());

    expect(uow.promover).toHaveBeenCalledTimes(1);
    expect(uow.promover).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: FECHA }),
    );
  });

  it('debe_reportar_la_promocion_con_re_bloqueo_y_alerta_interna', async () => {
    const { servicio } = montar();

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.promovida).toBe(true);
    expect(resultado.reservaPromovidaId).toBe('R2');
    expect(resultado.fechaReBloqueada).toBe(true);
    expect(resultado.alertaInternaRegistrada).toBe(true);
    expect(resultado.anomalia).toBe(false);
  });
});

// ===========================================================================
// FA-01 — cola de UN elemento: promueve y no reordena a nadie.
// ===========================================================================

describe('PromoverPrimeroEnColaService — FA-01 cola de un elemento', () => {
  it('debe_promover_sin_reordenar_cuando_la_cola_tenia_un_solo_elemento', async () => {
    const { servicio } = montar({
      promovida: true,
      reservaPromovidaId: 'R2',
      fechaReBloqueada: true,
      reordenadas: 0,
      alertaInternaRegistrada: true,
      anomalia: false,
    });

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.promovida).toBe(true);
    expect(resultado.reordenadas).toBe(0);
  });
});

// ===========================================================================
// FA-03 — cola de >2: promueve y reordena N-1 restantes.
// ===========================================================================

describe('PromoverPrimeroEnColaService — FA-03 cola de más de dos', () => {
  it('debe_reportar_los_reordenamientos_del_resto_de_la_cola', async () => {
    const { servicio } = montar({
      promovida: true,
      reservaPromovidaId: 'R2',
      fechaReBloqueada: true,
      reordenadas: 2, // R3, R4 decrementados.
      alertaInternaRegistrada: true,
      anomalia: false,
    });

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.promovida).toBe(true);
    expect(resultado.reordenadas).toBe(2);
  });
});

// ===========================================================================
// FA-02 — sin cola: no-op sin error (idempotencia defensiva). No promueve, no
//   re-bloquea, no registra alerta.
//   spec-delta: "Liberación sin cola no promueve y no da error".
// ===========================================================================

describe('PromoverPrimeroEnColaService — FA-02 sin cola es no-op sin error', () => {
  it('no_debe_promover_ni_registrar_alerta_cuando_no_hay_candidato', async () => {
    const { servicio } = montar({
      promovida: false,
      reservaPromovidaId: null,
      fechaReBloqueada: false,
      reordenadas: 0,
      alertaInternaRegistrada: false,
      anomalia: false,
    });

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.promovida).toBe(false);
    expect(resultado.fechaReBloqueada).toBe(false);
    expect(resultado.alertaInternaRegistrada).toBe(false);
  });
});

// ===========================================================================
// FA-04 — idempotencia por la guarda "ya promovida": si otra ejecución ya promovió
//   (segunda instancia del job / manual US-019), la UoW aborta sin cambios y el
//   caso de uso lo reporta como no-op (sin error, sin alerta duplicada).
//   spec-delta: "Segunda ejecución del job sobre una fecha ya promovida no hace nada".
// ===========================================================================

describe('PromoverPrimeroEnColaService — FA-04 idempotencia guarda "ya promovida"', () => {
  it('no_debe_promover_ni_duplicar_alerta_cuando_la_guarda_ya_promovida_aborta', async () => {
    const { servicio } = montar({
      promovida: false, // guarda "ya promovida": la fecha ya apunta a la nueva bloqueante.
      reservaPromovidaId: null,
      fechaReBloqueada: false,
      reordenadas: 0,
      alertaInternaRegistrada: false,
      anomalia: false,
    });

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.promovida).toBe(false);
    expect(resultado.alertaInternaRegistrada).toBe(false);
  });

  it('no_debe_lanzar_error_cuando_la_promocion_es_un_no_op_idempotente', async () => {
    const { servicio } = montar({
      promovida: false,
      reservaPromovidaId: null,
      fechaReBloqueada: false,
      reordenadas: 0,
      alertaInternaRegistrada: false,
      anomalia: false,
    });

    await expect(servicio.ejecutar(comando())).resolves.toBeDefined();
  });
});

// ===========================================================================
// 3.4 — Anomalía de posiciones no contiguas: la UoW audita y aborta sin promover;
//   el caso de uso reporta `anomalia = true` y NO como promoción efectiva.
//   spec-delta: "Cola con posiciones no contiguas aborta la promoción".
// ===========================================================================

describe('PromoverPrimeroEnColaService — anomalía de posiciones no contiguas', () => {
  it('debe_reportar_anomalia_y_no_promover_cuando_la_cola_no_es_contigua', async () => {
    const { servicio } = montar({
      promovida: false,
      reservaPromovidaId: null,
      fechaReBloqueada: false,
      reordenadas: 0,
      alertaInternaRegistrada: false,
      anomalia: true, // audita + aborta sin corrección silenciosa.
    });

    const resultado = await servicio.ejecutar(comando());

    expect(resultado.anomalia).toBe(true);
    expect(resultado.promovida).toBe(false);
    expect(resultado.fechaReBloqueada).toBe(false);
  });
});

// ===========================================================================
// Multi-tenancy (D-7): el caso de uso propaga SIEMPRE el tenant del comando (el de
// la fecha liberada) a la UoW; nunca lo toma de otro sitio.
// ===========================================================================

describe('PromoverPrimeroEnColaService — RLS por tenant de la fecha (D-7)', () => {
  it('debe_pasar_a_la_uow_el_tenant_recibido_en_el_comando', async () => {
    const { servicio, uow } = montar();

    await servicio.ejecutar(comando({ tenantId: OTRO_TENANT }));

    expect(uow.promover).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT }),
    );
  });
});

// ===========================================================================
// El caso de uso implementa la firma del seam `PromocionColaPort`: expone
// `promoverPrimeroEnCola({ tenantId, fecha })` para que el adaptador lo invoque sin
// re-cablear el disparo heredado de US-012/US-041 (D-1).
// ===========================================================================

describe('PromoverPrimeroEnColaService — compatible con la firma del seam heredado (D-1)', () => {
  it('debe_exponer_promoverPrimeroEnCola_delegando_en_ejecutar', async () => {
    const { servicio, uow } = montar();

    await servicio.promoverPrimeroEnCola({ tenantId: TENANT, fecha: FECHA });

    expect(uow.promover).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: FECHA }),
    );
  });
});
