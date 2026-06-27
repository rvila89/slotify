/**
 * TESTS DE DOMINIO de la operación `liberarFecha()` (US-041 / UC-31) — fase TDD RED.
 *
 * Trazabilidad: US-041, spec-delta `bloqueo-fecha` (requisitos de idempotencia,
 * guarda firme, disparo del seam de promoción, no-mutación de la RESERVA y
 * AUDIT_LOG), design.md (D-2 seam `PromocionColaPort`, D-4 rows-affected como
 * primitiva, D-5 guarda firme declarativa, D-6 hexagonal, D-8 AUDIT_LOG vía
 * puerto). Complemento atómico de `bloquearFecha()` (US-040); dolores D4/D13.
 *
 * Estos tests ejercitan el DOMINIO PURO contra DOBLES DE LOS PUERTOS (in-memory),
 * sin tocar Prisma ni la BD (hexagonal, hook `no-infra-in-domain`). Cubren:
 *   - 3.3 idempotencia: DELETE de 0 filas = éxito silencioso, tentativa auditada,
 *     sin disparar promoción;
 *   - 3.4 guarda del bloqueo firme (declarativa): rechazo en `reserva_confirmada`
 *     con fila intacta + intento auditado; permitido en `reserva_cancelada`;
 *   - 3.5 disparo del seam de promoción: invoca `PromocionColaPort` una vez con
 *     cola activa, cero veces sin cola;
 *   - 3.7 no-mutación de la RESERVA: el servicio no posee ningún puerto de
 *     escritura de RESERVA;
 *   - 3.8 AUDIT_LOG: cada liberación exitosa registra `accion='eliminar'`,
 *     `entidad='FECHA_BLOQUEADA'` y la causa (TTL/descarte/cancelación).
 *
 * La ZONA CRÍTICA de concurrencia (1 DELETE + 1 no-op, 1 sola promoción), la race
 * liberación-vs-bloqueo y el lote con fallo aislado viven en el spec de
 * integración hermano (`liberar-fecha-integracion.spec.ts`, BD real).
 *
 * RED: en este punto NO existe `reservas/domain/liberar-fecha.service.ts`; el
 * import falla y toda la batería está en ROJO por símbolos ausentes. La fase
 * GREEN (implementación del dominio + adaptadores) es de `backend-developer`.
 */
import {
  LiberarFechaService,
  liberacionFirmePermitida,
  LiberacionBloqueoFirmeNoPermitidaError,
  type CausaLiberacion,
  type LiberarFechaComando,
  type LiberacionResultado,
  type EstadoReservaDominio,
  type FechaBloqueadaLiberacionPort,
  type ReservaEstadoPort,
  type ColaQueryPort,
  type PromocionColaPort,
  type AuditLogPort,
} from '../domain/liberar-fecha.service';
import type { TipoBloqueoDominio } from '../domain/bloquear-fecha.service';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_R = 'reserva-R';
const FECHA = new Date('2026-09-12T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El dominio depende de estas INTERFACES; aquí
// van implementaciones fake con spies para verificar llamadas y argumentos.
// ---------------------------------------------------------------------------

type RepoFake = FechaBloqueadaLiberacionPort & {
  consultarBloqueo: jest.Mock;
  liberar: jest.Mock;
};
type ReservaEstadoFake = ReservaEstadoPort & { obtenerEstado: jest.Mock };
type ColaFake = ColaQueryPort & { hayColaActiva: jest.Mock };
type PromocionFake = PromocionColaPort & { promoverPrimeroEnCola: jest.Mock };
type AuditFake = AuditLogPort & { registrar: jest.Mock };

/**
 * Repo fake. `consultarBloqueo` devuelve por defecto un bloqueo BLANDO (la guarda
 * firme no aplica) y `liberar` devuelve 1 fila afectada (liberación efectiva).
 */
const crearRepoFake = (opts?: {
  bloqueo?: { reservaId: string; tipoBloqueo: TipoBloqueoDominio } | null;
  filasAfectadas?: number;
}): RepoFake => {
  const bloqueo =
    opts?.bloqueo === undefined
      ? { reservaId: RESERVA_R, tipoBloqueo: 'blando' as TipoBloqueoDominio }
      : opts.bloqueo;
  const filas = opts?.filasAfectadas ?? 1;
  const consultarBloqueo = jest.fn(async () => bloqueo);
  const liberar = jest.fn(async () => ({
    filasAfectadas: filas,
    reservaIdLiberada: filas > 0 ? (bloqueo?.reservaId ?? RESERVA_R) : null,
    tipoBloqueo: filas > 0 ? (bloqueo?.tipoBloqueo ?? null) : null,
  }));
  return { consultarBloqueo, liberar };
};

const crearReservaEstadoFake = (
  estado: EstadoReservaDominio | null = 'pre_reserva',
): ReservaEstadoFake => ({
  obtenerEstado: jest.fn(async () => estado),
});

const crearColaFake = (hayCola = false): ColaFake => ({
  hayColaActiva: jest.fn(async () => hayCola),
});

const crearPromocionFake = (): PromocionFake => ({
  promoverPrimeroEnCola: jest.fn(async () => undefined),
});

const crearAuditFake = (): AuditFake => ({
  registrar: jest.fn(async () => undefined),
});

const montarServicio = (opts?: {
  repo?: RepoFake;
  reservaEstado?: ReservaEstadoFake;
  cola?: ColaFake;
  promocion?: PromocionFake;
  auditoria?: AuditFake;
}) => {
  const repo = opts?.repo ?? crearRepoFake();
  const reservaEstado = opts?.reservaEstado ?? crearReservaEstadoFake();
  const cola = opts?.cola ?? crearColaFake(false);
  const promocion = opts?.promocion ?? crearPromocionFake();
  const auditoria = opts?.auditoria ?? crearAuditFake();
  const servicio = new LiberarFechaService({
    repositorio: repo,
    reservaEstado,
    cola,
    promocion,
    auditoria,
  });
  return { servicio, repo, reservaEstado, cola, promocion, auditoria };
};

const comandoBase = (over: Partial<LiberarFechaComando> = {}): LiberarFechaComando => ({
  tenantId: TENANT,
  fecha: FECHA,
  causa: 'TTL' as CausaLiberacion,
  ...over,
});

// ===========================================================================
// 3.4 (parte declarativa) — Guarda firme como estructura de datos (D-5)
//     spec-delta: "Guarda de liberación del bloqueo firme"
// ===========================================================================

describe('liberacionFirmePermitida — guarda firme declarativa (D-5)', () => {
  it('debe_permitir_liberar_un_firme_solo_cuando_la_reserva_esta_cancelada', () => {
    expect(liberacionFirmePermitida('reserva_cancelada')).toBe(true);
  });

  it('debe_prohibir_liberar_un_firme_en_cualquier_estado_no_cancelado', () => {
    const noCancelados: EstadoReservaDominio[] = [
      'consulta',
      'pre_reserva',
      'reserva_confirmada',
      'evento_en_curso',
      'post_evento',
      'reserva_completada',
    ];
    for (const estado of noCancelados) {
      expect(liberacionFirmePermitida(estado)).toBe(false);
    }
  });
});

// ===========================================================================
// 3.4 — Guarda del bloqueo firme en el servicio
//     spec-delta: "Liberar bloqueo firme de reserva activa es rechazado" /
//                 "… de reserva cancelada es permitido"
// ===========================================================================

describe('LiberarFechaService — guarda del bloqueo firme', () => {
  it('debe_rechazar_la_liberacion_de_un_firme_cuando_la_reserva_no_esta_cancelada', async () => {
    const repo = crearRepoFake({ bloqueo: { reservaId: RESERVA_R, tipoBloqueo: 'firme' } });
    const reservaEstado = crearReservaEstadoFake('reserva_confirmada');
    const { servicio } = montarServicio({ repo, reservaEstado });

    await expect(servicio.ejecutar(comandoBase({ causa: 'cancelacion' }))).rejects.toBeInstanceOf(
      LiberacionBloqueoFirmeNoPermitidaError,
    );
  });

  it('debe_dejar_la_fila_firme_intacta_no_invocando_el_DELETE_cuando_la_guarda_falla', async () => {
    const repo = crearRepoFake({ bloqueo: { reservaId: RESERVA_R, tipoBloqueo: 'firme' } });
    const reservaEstado = crearReservaEstadoFake('reserva_confirmada');
    const { servicio } = montarServicio({ repo, reservaEstado });

    await expect(servicio.ejecutar(comandoBase())).rejects.toBeDefined();

    // La guarda es PREVIA al DELETE: el repositorio de liberación nunca se invoca.
    expect(repo.liberar).not.toHaveBeenCalled();
  });

  it('debe_auditar_el_intento_rechazado_de_liberar_un_firme', async () => {
    const repo = crearRepoFake({ bloqueo: { reservaId: RESERVA_R, tipoBloqueo: 'firme' } });
    const reservaEstado = crearReservaEstadoFake('reserva_confirmada');
    const { servicio, auditoria } = montarServicio({ repo, reservaEstado });

    await servicio.ejecutar(comandoBase()).catch(() => undefined);

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'eliminar',
        entidad: 'FECHA_BLOQUEADA',
        resultado: 'rechazo_firme',
      }),
    );
  });

  it('debe_permitir_liberar_un_firme_cuando_la_reserva_esta_cancelada', async () => {
    const repo = crearRepoFake({ bloqueo: { reservaId: RESERVA_R, tipoBloqueo: 'firme' } });
    const reservaEstado = crearReservaEstadoFake('reserva_cancelada');
    const { servicio } = montarServicio({ repo, reservaEstado });

    const out: LiberacionResultado = await servicio.ejecutar(comandoBase({ causa: 'cancelacion' }));

    expect(out.liberada).toBe(true);
    expect(repo.liberar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.5 — Disparo del seam de promoción de cola (D-2)
//     spec-delta: "Disparo de la promoción de cola tras liberar (seam US-018)"
// ===========================================================================

describe('LiberarFechaService — disparo del seam de promoción (US-018)', () => {
  it('debe_invocar_PromocionColaPort_exactamente_una_vez_cuando_hay_cola_activa', async () => {
    const cola = crearColaFake(true);
    const { servicio, promocion } = montarServicio({ cola });

    await servicio.ejecutar(comandoBase());

    expect(promocion.promoverPrimeroEnCola).toHaveBeenCalledTimes(1);
    expect(promocion.promoverPrimeroEnCola).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: FECHA }),
    );
  });

  it('no_debe_invocar_PromocionColaPort_cuando_no_hay_cola_activa', async () => {
    const cola = crearColaFake(false);
    const { servicio, promocion } = montarServicio({ cola });

    await servicio.ejecutar(comandoBase());

    expect(promocion.promoverPrimeroEnCola).not.toHaveBeenCalled();
  });

  it('debe_reflejar_en_el_resultado_que_la_promocion_fue_disparada', async () => {
    const cola = crearColaFake(true);
    const { servicio } = montarServicio({ cola });

    const out = await servicio.ejecutar(comandoBase());

    expect(out.promocionDisparada).toBe(true);
  });
});

// ===========================================================================
// 3.3 — Idempotencia: DELETE de 0 filas = éxito silencioso (D-4)
//     spec-delta: "Idempotencia — DELETE de 0 filas es éxito silencioso"
// ===========================================================================

describe('LiberarFechaService — idempotencia (0 filas afectadas)', () => {
  it('no_debe_lanzar_excepcion_cuando_no_existe_bloqueo_para_la_fecha', async () => {
    const repo = crearRepoFake({ bloqueo: null, filasAfectadas: 0 });
    const { servicio } = montarServicio({ repo });

    const out = await servicio.ejecutar(comandoBase());

    expect(out.liberada).toBe(false);
    expect(out.filasAfectadas).toBe(0);
  });

  it('debe_auditar_la_tentativa_idempotente_cuando_el_DELETE_afecta_0_filas', async () => {
    const repo = crearRepoFake({ bloqueo: null, filasAfectadas: 0 });
    const { servicio, auditoria } = montarServicio({ repo });

    await servicio.ejecutar(comandoBase());

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'eliminar',
        entidad: 'FECHA_BLOQUEADA',
        resultado: 'tentativa_idempotente',
      }),
    );
  });

  it('no_debe_disparar_la_promocion_cuando_el_DELETE_afecta_0_filas', async () => {
    // Aun con cola "activa", un DELETE de 0 filas (otra TX liberó antes) NO promueve.
    const repo = crearRepoFake({ bloqueo: null, filasAfectadas: 0 });
    const cola = crearColaFake(true);
    const { servicio, promocion } = montarServicio({ repo, cola });

    await servicio.ejecutar(comandoBase());

    expect(promocion.promoverPrimeroEnCola).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.8 — AUDIT_LOG de toda liberación con su causa (D-8)
//     spec-delta: "Registro en AUDIT_LOG de toda liberación con su causa"
// ===========================================================================

describe('LiberarFechaService — registro en AUDIT_LOG con la causa', () => {
  it('debe_registrar_la_liberacion_exitosa_con_accion_eliminar_entidad_y_causa_TTL', async () => {
    const { servicio, auditoria } = montarServicio();

    await servicio.ejecutar(comandoBase({ causa: 'TTL' }));

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        accion: 'eliminar',
        entidad: 'FECHA_BLOQUEADA',
        causa: 'TTL',
        resultado: 'liberada',
      }),
    );
  });

  it('debe_propagar_la_causa_descarte_al_registro_de_auditoria', async () => {
    const { servicio, auditoria } = montarServicio();

    await servicio.ejecutar(comandoBase({ causa: 'descarte' }));

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ causa: 'descarte', resultado: 'liberada' }),
    );
  });
});

// ===========================================================================
// 3.7 — La liberación NO muta el estado de la RESERVA
//     spec-delta: "La liberación no muta el estado de la RESERVA"
// ===========================================================================

describe('LiberarFechaService — no muta la RESERVA', () => {
  it('no_debe_exponer_ningun_puerto_de_escritura_de_la_reserva', async () => {
    const { servicio } = montarServicio();

    await servicio.ejecutar(comandoBase());

    // El servicio solo lee el estado de la reserva (guarda firme); no posee
    // ningún colaborador para mutar `estado`/`sub_estado` de la RESERVA.
    expect(Object.keys(servicio)).not.toContain('reservaRepository');
    expect(Object.keys(servicio)).not.toContain('reservaWriter');
  });

  it('debe_limitar_sus_efectos_a_liberar_FECHA_BLOQUEADA_y_auditar', async () => {
    const { servicio, repo, reservaEstado, auditoria } = montarServicio();

    await servicio.ejecutar(comandoBase());

    // Solo se invoca el DELETE de FECHA_BLOQUEADA + la auditoría; el puerto de
    // RESERVA es de LECTURA (estado), nunca de escritura.
    expect(repo.liberar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    // `obtenerEstado` es lectura pura: existe el método de lectura, no de escritura.
    expect(typeof reservaEstado.obtenerEstado).toBe('function');
    expect((reservaEstado as unknown as Record<string, unknown>).actualizarEstado).toBeUndefined();
  });
});
