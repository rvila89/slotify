/**
 * TESTS DE APLICACIÓN del caso de uso `IniciarEventosDelDiaService`
 * (US-031 / UC-23, actor Sistema) — fase TDD RED. tasks.md Fase 3:
 * 3.3, 3.4, 3.5, 3.6, 3.9, 3.10 (a nivel de aplicación).
 *
 * Trazabilidad: US-031; spec-delta `consultas` (Requirements: "Barrido periódico
 * protegido de inicio automático de evento en T-0", "Transición atómica a
 * evento_en_curso solo con las tres precondiciones cumplidas", "Precondiciones
 * incumplidas — no transiciona y alerta crítica al gestor", "A29 — alerta no bloqueante
 * si las condiciones particulares no están firmadas", "Filtro estricto por estado y
 * fecha", "Idempotencia del barrido", "Procesa todas las elegibles con aislamiento de
 * fallos por RESERVA", "La auditoría del inicio automático registra el origen Sistema");
 * design.md §D-3/§D-4/§D-6/§D-7/§D-8.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de uso
 * contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la BD. Tres puertos, en
 * paralelo estricto al barrido de US-012/US-026:
 *   - `CandidatasInicioEventoPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *     RESERVA con `estado = 'reserva_confirmada'` AND `date(fecha_evento) = date(hoy)`
 *     (D-4). La SELECCIÓN (filtro estricto por estado y por fecha de calendario) es del
 *     adaptador (cubierta en integración, tests 3.6/3.7); aquí la lista llega filtrada.
 *   - `InicioEventoPort.iniciarEvento(candidata)` — UoW ATÓMICA por RESERVA: bajo el
 *     contexto RLS del tenant de la candidata, `SELECT … FOR UPDATE`, re-evalúa la guarda
 *     de origen + las tres precondiciones, y —si sigue siendo candidata y cumple—
 *     transiciona `reserva_confirmada → evento_en_curso` + AUDIT_LOG transición origen
 *     Sistema; si no cumple, NO transiciona y devuelve las precondiciones incumplidas;
 *     además señala A29 si `cond_part_firmadas = false`.
 *   - `AlertaInicioEventoPort` — emite la alerta CRÍTICA (precondiciones incumplidas) y
 *     la alerta A29 (no bloqueante), sin acoplar la superficie de notificaciones (D-8).
 *
 * RED: aún NO existe `application/iniciar-eventos-del-dia.service.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  IniciarEventosDelDiaService,
  type CandidatasInicioEventoPort,
  type InicioEventoPort,
  type AlertaInicioEventoPort,
  type EventoCandidato,
  type ResultadoInicioEvento,
  type ResumenBarridoEventos,
} from '../application/iniciar-eventos-del-dia.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';

/** Fecha de calendario de "hoy" a mediodía UTC (candidata determinista del barrido). */
const hoy = (): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return base;
};

// ---------------------------------------------------------------------------
// Dobles de los puertos (in-memory) con spies.
// ---------------------------------------------------------------------------

const candidata = (over: Partial<EventoCandidato> = {}): EventoCandidato => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  tenantId: TENANT_A,
  fechaEvento: hoy(),
  preEventoStatus: 'cerrado',
  liquidacionStatus: 'cobrada',
  fianzaStatus: 'cobrada',
  condPartFirmadas: true,
  ...over,
});

type CandidatasFake = CandidatasInicioEventoPort & { listarCandidatas: jest.Mock };
type InicioFake = InicioEventoPort & { iniciarEvento: jest.Mock };
type AlertaFake = AlertaInicioEventoPort & {
  emitirPrecondicionesIncumplidas: jest.Mock;
  emitirA29: jest.Mock;
};

const crearCandidatasFake = (candidatas: EventoCandidato[]): CandidatasFake => ({
  listarCandidatas: jest.fn(async () => candidatas),
});

/**
 * Doble de la UoW por RESERVA. Por defecto: si cumple las tres precondiciones →
 * `iniciado = true` (transiciona); si no → `iniciado = false` con las faltantes; A29 se
 * deriva de `condPartFirmadas`. `resultados` mapea reservaId → desenlace o `'lanza'`
 * (para el fallo aislado) o `false`-under-lock (idempotencia bajo lock).
 */
const crearInicioFake = (
  resultados?: Record<string, ResultadoInicioEvento | 'lanza'>,
): InicioFake => ({
  iniciarEvento: jest.fn(async (c: EventoCandidato): Promise<ResultadoInicioEvento> => {
    const r = resultados?.[c.reservaId];
    if (r === 'lanza') {
      throw new Error('fallo simulado de inicio de evento');
    }
    if (r) {
      return r;
    }
    const faltantes: string[] = [];
    if (c.preEventoStatus !== 'cerrado') faltantes.push('pre_evento_status');
    if (c.liquidacionStatus !== 'cobrada') faltantes.push('liquidacion_status');
    if (c.fianzaStatus !== 'cobrada') faltantes.push('fianza_status');
    const cumple = faltantes.length === 0;
    return {
      reservaId: c.reservaId,
      iniciado: cumple,
      precondicionesIncumplidas: cumple ? null : faltantes,
      condPartNoFirmadas: c.condPartFirmadas === false,
    };
  }),
});

const crearAlertaFake = (): AlertaFake => ({
  emitirPrecondicionesIncumplidas: jest.fn(async () => undefined),
  emitirA29: jest.fn(async () => undefined),
});

const montar = (
  candidatas: EventoCandidato[],
  resultados?: Record<string, ResultadoInicioEvento | 'lanza'>,
) => {
  const candidatasPort = crearCandidatasFake(candidatas);
  const inicioPort = crearInicioFake(resultados);
  const alertaPort = crearAlertaFake();
  const servicio = new IniciarEventosDelDiaService({
    candidatas: candidatasPort,
    inicio: inicioPort,
    alerta: alertaPort,
  });
  return { servicio, candidatasPort, inicioPort, alertaPort };
};

// ===========================================================================
// 3.3 — Happy path: candidata reserva_confirmada + fecha_evento hoy + 3 precondiciones
//        → se transiciona a evento_en_curso; el resumen cuenta 1 evento iniciado. El
//        use-case delega en la UoW `iniciarEvento` pasando el tenant de la fila; la
//        AUDIT_LOG transición origen Sistema es responsabilidad de la UoW (verificada en
//        integración 3.3-DB): aquí se comprueba la ORQUESTACIÓN y el resumen.
//        spec-delta: "RESERVA confirmada con las tres precondiciones … transiciona".
// ===========================================================================

describe('IniciarEventosDelDiaService — happy path (3.3)', () => {
  it('debe_iniciar_el_evento_y_reflejar_uno_iniciado_en_el_resumen', async () => {
    const c = candidata();
    const { servicio, inicioPort } = montar([c]);

    const resumen: ResumenBarridoEventos = await servicio.ejecutar();

    expect(inicioPort.iniciarEvento).toHaveBeenCalledTimes(1);
    expect(inicioPort.iniciarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, tenantId: TENANT_A }),
    );
    expect(resumen.candidatas).toBe(1);
    expect(resumen.eventosIniciados).toBe(1);
    expect(resumen.precondicionesIncumplidas).toBe(0);
    expect(resumen.fallos).toBe(0);
  });

  it('no_debe_emitir_alerta_critica_ni_A29_cuando_todo_esta_en_orden', async () => {
    const c = candidata({ condPartFirmadas: true });
    const { servicio, alertaPort } = montar([c]);

    await servicio.ejecutar();

    expect(alertaPort.emitirPrecondicionesIncumplidas).not.toHaveBeenCalled();
    expect(alertaPort.emitirA29).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Precondiciones incumplidas: alguna de las tres distinta de su valor requerido →
//        NO transiciona (no cuenta como iniciado), 0 auditorías (la UoW no muta), alerta
//        crítica con la LISTA de precondiciones incumplidas; el resumen la contabiliza
//        como precondiciones incumplidas.
//        spec-delta: "Precondiciones incumplidas — no transiciona y alerta crítica".
// ===========================================================================

describe('IniciarEventosDelDiaService — precondiciones incumplidas (3.4)', () => {
  it('no_debe_iniciar_y_debe_emitir_alerta_critica_con_la_lista_de_incumplidas', async () => {
    const c = candidata({ liquidacionStatus: 'facturada' });
    const { servicio, alertaPort, inicioPort } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(inicioPort.iniciarEvento).toHaveBeenCalledTimes(1);
    expect(resumen.eventosIniciados).toBe(0);
    expect(resumen.precondicionesIncumplidas).toBe(1);
    expect(resumen.fallos).toBe(0);

    // Alerta crítica al gestor enumerando la(s) precondición(es) incumplida(s).
    expect(alertaPort.emitirPrecondicionesIncumplidas).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitirPrecondicionesIncumplidas).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: c.reservaId,
        tenantId: TENANT_A,
        incumplidas: ['liquidacion_status'],
      }),
    );
  });
});

// ===========================================================================
// 3.5 — A29 (efecto colateral NO bloqueante): tres precondiciones cumplidas +
//        `cond_part_firmadas = false` → transiciona IGUALMENTE a evento_en_curso Y emite
//        A29. A29 se dispara con INDEPENDENCIA del resultado de la transición.
//        spec-delta: "Tres precondiciones cumplidas pero condiciones particulares no
//        firmadas".
// ===========================================================================

describe('IniciarEventosDelDiaService — A29 no bloqueante (3.5)', () => {
  it('debe_iniciar_igualmente_y_emitir_A29_cuando_cond_part_no_firmadas', async () => {
    const c = candidata({ condPartFirmadas: false });
    const { servicio, alertaPort } = montar([c]);

    const resumen = await servicio.ejecutar();

    // La transición SE EJECUTA aunque las condiciones particulares no estén firmadas.
    expect(resumen.eventosIniciados).toBe(1);
    // A29 se emite (no bloqueante) para esta RESERVA.
    expect(alertaPort.emitirA29).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitirA29).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, tenantId: TENANT_A }),
    );
    // No hay precondiciones incumplidas: no se dispara la alerta crítica.
    expect(alertaPort.emitirPrecondicionesIncumplidas).not.toHaveBeenCalled();
  });

  it('debe_emitir_A29_con_independencia_del_resultado_incluso_si_no_transiciona', async () => {
    // cond_part_firmadas=false Y una precondición incumplida: NO transiciona, pero A29 se
    // dispara igualmente (independencia del resultado de la transición).
    const c = candidata({ condPartFirmadas: false, fianzaStatus: 'pendiente' });
    const { servicio, alertaPort } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.eventosIniciados).toBe(0);
    expect(resumen.precondicionesIncumplidas).toBe(1);
    expect(alertaPort.emitirA29).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitirPrecondicionesIncumplidas).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.6/3.7 (a nivel de aplicación) — Cross-tenant read, mutación por tenant de la fila
//        (D-5): el barrido es cross-tenant en la lectura, pero cada inicio recibe el
//        `tenantId` de SU candidata (nunca de input externo). El filtro estricto por
//        estado y por `date(fecha_evento) = date(hoy)` es responsabilidad de la SELECCIÓN
//        (adaptador de candidatas, cubierto en integración 3.6/3.7): el use-case inicia
//        lo que `listarCandidatas` le entrega.
// ===========================================================================

describe('IniciarEventosDelDiaService — cross-tenant read, inicio por tenant de la fila', () => {
  it('debe_procesar_candidatas_de_varios_tenants_pasando_el_tenant_de_cada_fila', async () => {
    const a = candidata({ tenantId: TENANT_A });
    const b = candidata({ tenantId: TENANT_B });
    const { servicio, inicioPort } = montar([a, b]);

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(2);
    expect(resumen.eventosIniciados).toBe(2);
    expect(inicioPort.iniciarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
    expect(inicioPort.iniciarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B }),
    );
  });

  it('debe_devolver_un_resumen_en_ceros_cuando_no_hay_candidatas', async () => {
    const { servicio, inicioPort, alertaPort } = montar([]);

    const resumen = await servicio.ejecutar();

    expect(inicioPort.iniciarEvento).not.toHaveBeenCalled();
    expect(alertaPort.emitirPrecondicionesIncumplidas).not.toHaveBeenCalled();
    expect(alertaPort.emitirA29).not.toHaveBeenCalled();
    expect(resumen).toEqual<ResumenBarridoEventos>({
      candidatas: 0,
      eventosIniciados: 0,
      precondicionesIncumplidas: 0,
      fallos: 0,
    });
  });
});

// ===========================================================================
// 3.8 (a nivel de aplicación) — Idempotencia: una candidata que bajo lock YA NO era
//        candidata (`iniciado = false`, `precondicionesIncumplidas = null`: la
//        re-evaluación de la guarda de origen la vio ya `evento_en_curso`, p. ej. un
//        pase previo o el gestor US-032) → no cuenta como iniciada, ni como
//        precondiciones incumplidas, ni como fallo, ni emite alerta.
//        spec-delta: "Idempotencia del barrido — reserva ya en evento_en_curso".
// ===========================================================================

describe('IniciarEventosDelDiaService — idempotencia (ya iniciada bajo lock) (3.8)', () => {
  it('no_debe_contar_ni_alertar_una_reserva_que_dejo_de_ser_candidata_bajo_lock', async () => {
    const c = candidata();
    const { servicio, alertaPort } = montar([c], {
      [c.reservaId]: {
        reservaId: c.reservaId,
        iniciado: false, // bajo lock ya era `evento_en_curso` (idempotencia / RC).
        precondicionesIncumplidas: null,
        condPartNoFirmadas: false,
      },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(1);
    expect(resumen.eventosIniciados).toBe(0);
    expect(resumen.precondicionesIncumplidas).toBe(0);
    expect(resumen.fallos).toBe(0);
    expect(alertaPort.emitirPrecondicionesIncumplidas).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.9 — Múltiples reservas de hoy: dos cumplidoras → 2 iniciadas (2 transiciones/
//        auditorías independientes), una incumplidora → alerta sin transición, una que
//        bajo lock ya estaba iniciada → omitida. Resumen = 2 eventosIniciados + 1
//        precondicionesIncumplidas.
//        spec-delta: "Varias reservas de hoy — cumplidoras inician, incumplidoras
//        alertan, ya iniciada se omite".
// ===========================================================================

describe('IniciarEventosDelDiaService — múltiples reservas de hoy (3.9)', () => {
  it('debe_iniciar_las_dos_cumplidoras_alertar_la_incumplidora_y_omitir_la_ya_iniciada', async () => {
    const ok1 = candidata();
    const ok2 = candidata();
    const incumplidora = candidata({ liquidacionStatus: 'facturada' });
    const yaIniciada = candidata();
    const { servicio, inicioPort, alertaPort } = montar(
      [ok1, ok2, incumplidora, yaIniciada],
      {
        [yaIniciada.reservaId]: {
          reservaId: yaIniciada.reservaId,
          iniciado: false,
          precondicionesIncumplidas: null,
          condPartNoFirmadas: false,
        },
      },
    );

    const resumen = await servicio.ejecutar();

    // Las cuatro candidatas se INTENTAN (cada una en su propia transacción).
    expect(inicioPort.iniciarEvento).toHaveBeenCalledTimes(4);
    expect(resumen.candidatas).toBe(4);
    expect(resumen.eventosIniciados).toBe(2);
    expect(resumen.precondicionesIncumplidas).toBe(1);
    expect(resumen.fallos).toBe(0);
    // Exactamente una alerta crítica (la incumplidora); la ya iniciada no alerta.
    expect(alertaPort.emitirPrecondicionesIncumplidas).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitirPrecondicionesIncumplidas).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: incumplidora.reservaId }),
    );
  });
});

// ===========================================================================
// 3.10 — Atomicidad / fallo aislado: el fallo de una candidata (excepción de su UoW) NO
//        aborta el lote; las demás se transicionan; el resumen refleja el fallo aislado.
//        Cada candidata se procesa en su PROPIA transacción independiente (semántica del
//        lote de US-012/US-026, D-6/D-7).
//        spec-delta: "Un fallo parcial en una candidata no revierte las demás".
// ===========================================================================

describe('IniciarEventosDelDiaService — fallo aislado por RESERVA (3.10)', () => {
  it('debe_iniciar_las_demas_aunque_una_lance_y_reflejar_el_fallo_aislado', async () => {
    const ok1 = candidata();
    const kaboom = candidata();
    const ok2 = candidata();
    const { servicio, inicioPort } = montar([ok1, kaboom, ok2], {
      [kaboom.reservaId]: 'lanza',
    });

    const resumen = await servicio.ejecutar();

    // Las tres candidatas se INTENTAN (fallo aislado, no corta el lote).
    expect(inicioPort.iniciarEvento).toHaveBeenCalledTimes(3);
    expect(resumen.candidatas).toBe(3);
    expect(resumen.eventosIniciados).toBe(2);
    expect(resumen.precondicionesIncumplidas).toBe(0);
    expect(resumen.fallos).toBe(1);
  });
});
