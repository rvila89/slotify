/**
 * TESTS DE APLICACIÓN del caso de uso `ExpirarConsultasVencidasService`
 * (US-012 / UC-09) — fase TDD RED. tasks.md Fase 3: 3.2, 3.3, 3.4, 3.5, 3.6, 3.9.
 *
 * Trazabilidad: US-012, spec-delta `consultas` (Requirements: expiración 2.b sin
 * cola, 2.b con cola, 2.c, 2.v con/sin cola heredada, pre_reserva; idempotencia;
 * atomicidad por RESERVA + fallo aislado), design.md §D-4 (idempotencia), §D-8
 * (solo DISPARA el seam, NO reimplementa A15), §D-9 (dominio puro + caso de uso de
 * aplicación: listar candidatas, por cada una en su propia transacción con
 * `SELECT … FOR UPDATE` re-evaluar guarda + transición + `liberarFecha()`, agregar
 * resumen con fallo aislado; reutiliza la semántica de `LiberarFechasEnLoteService`).
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de
 * uso contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la BD. Dos
 * puertos:
 *   - `CandidatasExpiracionPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *     RESERVA con `ttl_expiracion < now()` AND estados candidatos (D-6).
 *   - `ExpiracionReservaPort.expirarReserva()` — UoW atómica por RESERVA: bajo
 *     `SELECT … FOR UPDATE` re-evalúa la guarda, aplica la transición y delega en
 *     `liberarFecha()` (libera + audita + dispara el seam si hay cola). Devuelve el
 *     desenlace por RESERVA para que el use-case agregue el resumen.
 *
 * El disparo FIFO/re-bloqueo de la cola (A15) es de US-018: aquí SOLO se verifica que
 * el seam se marca como disparado exactamente una vez, no su implementación (D-8).
 *
 * RED: aún NO existe `application/expirar-consultas-vencidas.service.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ExpirarConsultasVencidasService,
  type CandidatasExpiracionPort,
  type ExpiracionReservaPort,
  type ReservaCandidata,
  type ResultadoExpiracionReserva,
  type ResumenBarrido,
} from '../application/expirar-consultas-vencidas.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';
const FECHA = new Date('2026-09-12T00:00:00.000Z');
const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Dobles de los puertos (in-memory) con spies.
// ---------------------------------------------------------------------------

const candidata = (over: Partial<ReservaCandidata> = {}): ReservaCandidata => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  tenantId: TENANT_A,
  fecha: FECHA,
  estado: 'consulta',
  subEstado: '2b',
  ttlExpiracion: AYER,
  ...over,
});

type CandidatasFake = CandidatasExpiracionPort & { listarCandidatas: jest.Mock };
type ExpiracionFake = ExpiracionReservaPort & { expirarReserva: jest.Mock };

const crearCandidatasFake = (candidatas: ReservaCandidata[]): CandidatasFake => ({
  listarCandidatas: jest.fn(async () => candidatas),
});

/**
 * Doble de la UoW por RESERVA. Por defecto expira con éxito (transición + fecha
 * liberada, sin promoción). `resultados` permite mapear reservaId → desenlace para
 * los tests de cola, idempotencia y fallo aislado.
 */
const crearExpiracionFake = (
  resultados?: Record<string, ResultadoExpiracionReserva | 'lanza'>,
): ExpiracionFake => ({
  expirarReserva: jest.fn(async (c: ReservaCandidata): Promise<ResultadoExpiracionReserva> => {
    const r = resultados?.[c.reservaId];
    if (r === 'lanza') {
      throw new Error('fallo simulado de expiración');
    }
    return (
      r ?? {
        reservaId: c.reservaId,
        expirada: true,
        estadoFinal: c.estado === 'pre_reserva' ? 'reserva_cancelada' : 'consulta',
        subEstadoFinal: c.estado === 'pre_reserva' ? null : '2x',
        fechaLiberada: true,
        promocionDisparada: false,
      }
    );
  }),
});

const montar = (
  candidatas: ReservaCandidata[],
  resultados?: Record<string, ResultadoExpiracionReserva | 'lanza'>,
) => {
  const candidatasPort = crearCandidatasFake(candidatas);
  const expiracionPort = crearExpiracionFake(resultados);
  const servicio = new ExpirarConsultasVencidasService({
    candidatas: candidatasPort,
    expiracion: expiracionPort,
  });
  return { servicio, candidatasPort, expiracionPort };
};

// ===========================================================================
// 3.2 — Expiración de 2.b SIN cola: transición 2b→2x + fecha liberada, sin promoción.
//     spec-delta: "Expiración en 2.b sin cola transiciona a 2.x y libera la fecha".
// ===========================================================================

describe('ExpirarConsultasVencidasService — 2.b sin cola', () => {
  it('debe_expirar_la_candidata_2b_a_2x_liberando_la_fecha_sin_disparar_promocion', async () => {
    const c = candidata({ subEstado: '2b' });
    const { servicio, expiracionPort } = montar([c]);

    const resumen: ResumenBarrido = await servicio.ejecutar();

    expect(expiracionPort.expirarReserva).toHaveBeenCalledTimes(1);
    expect(expiracionPort.expirarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, subEstado: '2b' }),
    );
    expect(resumen.candidatas).toBe(1);
    expect(resumen.expiradas).toBe(1);
    expect(resumen.promocionesDisparadas).toBe(0);
    expect(resumen.fallos).toBe(0);
  });
});

// ===========================================================================
// 3.3 — Expiración de 2.b CON cola: el seam de promoción se dispara EXACTAMENTE
//     una vez (D-8: solo el trigger, la reordenación A15 es de US-018).
//     spec-delta: "Expiración en 2.b con cola … dispara la promoción una vez".
// ===========================================================================

describe('ExpirarConsultasVencidasService — 2.b con cola (seam US-018)', () => {
  it('debe_contar_exactamente_una_promocion_disparada_cuando_la_reserva_tiene_cola', async () => {
    const c = candidata({ subEstado: '2b' });
    const { servicio } = montar([c], {
      [c.reservaId]: {
        reservaId: c.reservaId,
        expirada: true,
        estadoFinal: 'consulta',
        subEstadoFinal: '2x',
        fechaLiberada: true,
        promocionDisparada: true,
      },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.expiradas).toBe(1);
    // D-8: el seam se dispara una sola vez; US-012 NO reordena la cola (US-018).
    expect(resumen.promocionesDisparadas).toBe(1);
  });
});

// ===========================================================================
// 3.4 — 2.c (sin cola posible) y 2.v (con/sin cola heredada).
//     spec-delta: "Expiración en 2.c …" y "Expiración en 2.v … con promoción si
//     hereda cola".
// ===========================================================================

describe('ExpirarConsultasVencidasService — 2.c y 2.v', () => {
  it('debe_expirar_2c_a_2x_sin_promocion_posible', async () => {
    const c = candidata({ subEstado: '2c' });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.expiradas).toBe(1);
    expect(resumen.promocionesDisparadas).toBe(0);
  });

  it('debe_expirar_2v_sin_cola_heredada_a_2x_sin_promocion', async () => {
    const c = candidata({ subEstado: '2v' });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.expiradas).toBe(1);
    expect(resumen.promocionesDisparadas).toBe(0);
  });

  it('debe_disparar_una_promocion_cuando_2v_hereda_cola', async () => {
    const c = candidata({ subEstado: '2v' });
    const { servicio } = montar([c], {
      [c.reservaId]: {
        reservaId: c.reservaId,
        expirada: true,
        estadoFinal: 'consulta',
        subEstadoFinal: '2x',
        fechaLiberada: true,
        promocionDisparada: true,
      },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.promocionesDisparadas).toBe(1);
  });
});

// ===========================================================================
// 3.5 — pre_reserva → reserva_cancelada (sub_estado NULL), fecha liberada, sin
//     promoción (imposible tener cola en pre_reserva).
//     spec-delta: "Expiración en pre_reserva cancela la reserva y libera la fecha".
// ===========================================================================

describe('ExpirarConsultasVencidasService — pre_reserva', () => {
  it('debe_expirar_pre_reserva_a_reserva_cancelada_sin_promocion', async () => {
    const c = candidata({ estado: 'pre_reserva', subEstado: null });
    const { servicio, expiracionPort } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(expiracionPort.expirarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'pre_reserva', subEstado: null }),
    );
    expect(resumen.expiradas).toBe(1);
    expect(resumen.promocionesDisparadas).toBe(0);
  });
});

// ===========================================================================
// 3.6 — Idempotencia a nivel de use-case: una candidata que bajo lock ya NO es
//     candidata (otra TX la expiró) → `expirada = false`, no cuenta como expirada
//     ni como fallo.
//     spec-delta: "Idempotencia del barrido — N ejecuciones = 1 sola transición".
// ===========================================================================

describe('ExpirarConsultasVencidasService — idempotencia (candidata ya no candidata bajo lock)', () => {
  it('no_debe_contar_como_expirada_una_reserva_que_dejo_de_ser_candidata_bajo_lock', async () => {
    const c = candidata({ subEstado: '2b' });
    const { servicio } = montar([c], {
      [c.reservaId]: {
        reservaId: c.reservaId,
        expirada: false, // re-evaluación bajo lock: ya no candidata (idempotencia).
        estadoFinal: 'consulta',
        subEstadoFinal: '2x',
        fechaLiberada: false,
        promocionDisparada: false,
      },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(1);
    expect(resumen.expiradas).toBe(0);
    expect(resumen.fallos).toBe(0);
  });
});

// ===========================================================================
// 3.9 — Atomicidad / fallo aislado: el fallo de una candidata NO aborta el lote;
//     las demás se expiran; el resumen refleja el fallo aislado. Cada candidata se
//     procesa en su PROPIA transacción independiente (semántica de
//     `LiberarFechasEnLoteService`, D-9).
//     spec-delta: "Atomicidad por RESERVA y aislamiento de fallos en el lote".
// ===========================================================================

describe('ExpirarConsultasVencidasService — fallo aislado por RESERVA', () => {
  it('debe_expirar_las_demas_aunque_una_lance_y_reflejar_el_fallo_aislado', async () => {
    const ok1 = candidata({ subEstado: '2b' });
    const kaboom = candidata({ subEstado: '2c' });
    const ok2 = candidata({ estado: 'pre_reserva', subEstado: null });
    const { servicio, expiracionPort } = montar([ok1, kaboom, ok2], {
      [kaboom.reservaId]: 'lanza',
    });

    const resumen = await servicio.ejecutar();

    // Las tres candidatas se INTENTAN (fallo aislado, no corta el lote).
    expect(expiracionPort.expirarReserva).toHaveBeenCalledTimes(3);
    expect(resumen.candidatas).toBe(3);
    expect(resumen.expiradas).toBe(2);
    expect(resumen.fallos).toBe(1);
  });
});

// ===========================================================================
// Multi-tenancy (D-6): el barrido es CROSS-TENANT en la lectura, pero cada
// expiración recibe el `tenantId` de SU candidata (nunca de input externo). El
// use-case propaga el tenant de la fila, sin mezclar tenants.
// ===========================================================================

describe('ExpirarConsultasVencidasService — cross-tenant read, mutación por tenant de la fila', () => {
  it('debe_procesar_candidatas_de_varios_tenants_pasando_el_tenant_de_cada_fila', async () => {
    const a = candidata({ tenantId: TENANT_A, subEstado: '2b' });
    const b = candidata({ tenantId: TENANT_B, subEstado: '2c' });
    const { servicio, expiracionPort } = montar([a, b]);

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(2);
    expect(resumen.expiradas).toBe(2);
    // Cada expiración se invoca con el tenant de SU candidata (RLS write por tenant).
    expect(expiracionPort.expirarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
    expect(expiracionPort.expirarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B }),
    );
  });

  it('debe_devolver_un_resumen_en_ceros_cuando_no_hay_candidatas', async () => {
    const { servicio, expiracionPort } = montar([]);

    const resumen = await servicio.ejecutar();

    expect(expiracionPort.expirarReserva).not.toHaveBeenCalled();
    expect(resumen).toEqual<ResumenBarrido>({
      candidatas: 0,
      expiradas: 0,
      promocionesDisparadas: 0,
      fallos: 0,
    });
  });
});
