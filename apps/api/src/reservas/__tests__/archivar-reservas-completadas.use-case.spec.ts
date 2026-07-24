/**
 * TESTS DE APLICACIÓN del caso de uso `ArchivarReservasCompletadasService`
 * (US-037 / UC-28, actor Sistema) — fase TDD RED. tasks.md Fase 4:
 * 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 4.12 (a nivel de aplicación).
 *
 * Trazabilidad: US-037; spec-delta `consultas` (Requirements: "Transición atómica a
 * reserva_completada solo con la guarda de fianza resuelta", "Fianza no resuelta en T+7d
 * — no archiva y emite alerta interna al gestor sin duplicar", "Idempotencia del barrido",
 * "Procesa todas las elegibles con aislamiento de fallos por RESERVA", "La auditoría del
 * archivado automático registra el origen Sistema"); design.md §D-6/§D-7/§D-8, gate
 * D-3=3.1 + D-4=4.2.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de uso
 * contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la BD. Tres puertos, en
 * paralelo estricto al barrido de US-031/US-012:
 *   - `CandidatasArchivadoPort.listarCandidatas()` — lectura CROSS-TENANT de las RESERVA
 *     con `estado = 'post_evento'` AND `date(fechaPostEvento) <= hoy - 7` (D-2=A). La
 *     SELECCIÓN (filtro estricto por estado y por FECHA DE CALENDARIO — off-by-one TZ) es
 *     del adaptador (cubierta en integración, tests 4.8/4.9); aquí la lista llega filtrada.
 *   - `ArchivadoPort.archivarReserva(candidata)` — UoW ATÓMICA por RESERVA: bajo el
 *     contexto RLS del tenant de la candidata, `SELECT … FOR UPDATE`, re-evalúa la guarda
 *     de origen (`resolverArchivadoAutomatico`) + la guarda de fianza (`fianzaResuelta`), y
 *     — si sigue siendo `post_evento` y la fianza está resuelta — transiciona a
 *     `reserva_completada` + AUDIT_LOG transición origen Sistema (causa 'T+7d'); si la
 *     fianza está pendiente NO transiciona y devuelve `fianzaPendiente = true`; si bajo el
 *     lock ya no es candidata (idempotencia / RC) devuelve `archivada = false` sin más.
 *   - `AlertaFianzaPendientePort` — emite la alerta interna FA-01 como entrada de
 *     AUDIT_LOG (actor Sistema, usuario_id nulo, tipo `fianza_pendiente_t7d`, D-3=3.1) con
 *     ANTI-DUPLICACIÓN por AUDIT_LOG (D-4=4.2): `debeEmitir(candidata)` consulta si ya
 *     existe una alerta posterior al último cambio de fianza_status/fianza_eur.
 *
 * RED: aún NO existe `application/archivar-reservas-completadas.service.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ArchivarReservasCompletadasService,
  type CandidatasArchivadoPort,
  type ArchivadoPort,
  type AlertaFianzaPendientePort,
  type ReservaCompletableCandidata,
  type ResultadoArchivado,
  type ResumenBarridoCompletadas,
} from '../application/archivar-reservas-completadas.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';

/** Fecha de calendario a mediodía UTC desplazada `offsetDias` respecto a hoy. */
const DIA_MS = 24 * 60 * 60 * 1000;
const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};

// ---------------------------------------------------------------------------
// Dobles de los puertos (in-memory) con spies.
// ---------------------------------------------------------------------------

const candidata = (
  over: Partial<ReservaCompletableCandidata> = {},
): ReservaCompletableCandidata => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  codigo: `TST-${Math.random().toString(36).slice(2, 6)}`,
  tenantId: TENANT_A,
  fechaPostEvento: aMediodiaUTC(-8), // 8 días → candidata por antigüedad.
  fianzaStatus: 'devuelta',
  fianzaEur: 300,
  ...over,
});

type CandidatasFake = CandidatasArchivadoPort & { listarCandidatas: jest.Mock };
type ArchivadoFake = ArchivadoPort & { archivarReserva: jest.Mock };
type AlertaFake = AlertaFianzaPendientePort & {
  debeEmitir: jest.Mock;
  emitir: jest.Mock;
};

const crearCandidatasFake = (
  candidatas: ReservaCompletableCandidata[],
): CandidatasFake => ({
  listarCandidatas: jest.fn(async () => candidatas),
});

/**
 * Doble de la UoW por RESERVA. Por defecto deriva el desenlace de la guarda de fianza de
 * la candidata: fianza resuelta (`devuelta`/`retenida_parcial` o eur<=0/null) → archiva;
 * status pendiente con eur>0 → `fianzaPendiente = true` sin transicionar. `resultados`
 * mapea reservaId → desenlace forzado, `'lanza'` (fallo aislado) o `'yaCompletada'`
 * (idempotencia: bajo el lock ya no era post_evento).
 */
const fianzaResueltaLocal = (c: ReservaCompletableCandidata): boolean => {
  if (c.fianzaEur === null || c.fianzaEur <= 0) return true;
  return c.fianzaStatus === 'devuelta';
};

const crearArchivadoFake = (
  resultados?: Record<string, ResultadoArchivado | 'lanza' | 'yaCompletada'>,
): ArchivadoFake => ({
  archivarReserva: jest.fn(
    async (c: ReservaCompletableCandidata): Promise<ResultadoArchivado> => {
      const r = resultados?.[c.reservaId];
      if (r === 'lanza') {
        throw new Error('fallo simulado de archivado');
      }
      if (r === 'yaCompletada') {
        // Bajo el lock ya no era post_evento (pase previo / US-038): no-op.
        return { reservaId: c.reservaId, archivada: false, fianzaPendiente: false };
      }
      if (r && typeof r === 'object') {
        return r;
      }
      const resuelta = fianzaResueltaLocal(c);
      return {
        reservaId: c.reservaId,
        archivada: resuelta,
        fianzaPendiente: !resuelta,
      };
    },
  ),
});

/** Alerta fake: por defecto SIEMPRE debe emitir (no hay alerta previa). */
const crearAlertaFake = (debeEmitir = true): AlertaFake => ({
  debeEmitir: jest.fn(async () => debeEmitir),
  emitir: jest.fn(async () => undefined),
});

const montar = (
  candidatas: ReservaCompletableCandidata[],
  opts: {
    resultados?: Record<string, ResultadoArchivado | 'lanza' | 'yaCompletada'>;
    debeEmitirAlerta?: boolean;
  } = {},
) => {
  const candidatasPort = crearCandidatasFake(candidatas);
  const archivadoPort = crearArchivadoFake(opts.resultados);
  const alertaPort = crearAlertaFake(opts.debeEmitirAlerta ?? true);
  const servicio = new ArchivarReservasCompletadasService({
    candidatas: candidatasPort,
    archivado: archivadoPort,
    alerta: alertaPort,
  });
  return { servicio, candidatasPort, archivadoPort, alertaPort };
};

// ===========================================================================
// 4.3 — Happy path: candidata post_evento + T+7d + fianza devuelta → se archiva a
//        reserva_completada; el resumen cuenta 1 archivada. La AUDIT_LOG transición origen
//        Sistema (causa 'T+7d') es responsabilidad de la UoW (verificada en integración):
//        aquí se comprueba la ORQUESTACIÓN y el resumen.
//        spec-delta: "Fianza devuelta y T+7d cumplido — archiva".
// ===========================================================================

describe('ArchivarReservasCompletadasService — happy path fianza devuelta (4.3)', () => {
  it('debe_archivar_y_reflejar_una_archivada_en_el_resumen', async () => {
    const c = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, archivadoPort } = montar([c]);

    const resumen: ResumenBarridoCompletadas = await servicio.ejecutar();

    expect(archivadoPort.archivarReserva).toHaveBeenCalledTimes(1);
    expect(archivadoPort.archivarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, tenantId: TENANT_A }),
    );
    expect(resumen.candidatas).toBe(1);
    expect(resumen.archivadas).toBe(1);
    expect(resumen.fianzaPendiente).toBe(0);
    expect(resumen.fallos).toBe(0);
  });

  it('no_debe_emitir_alerta_cuando_la_fianza_esta_resuelta', async () => {
    const c = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, alertaPort } = montar([c]);

    await servicio.ejecutar();

    expect(alertaPort.emitir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4.4 — Sin fianza (fianza_eur = 0 o NULL): archiva sin evaluar fianza_status. Se prueban
//        ambos (0 y null) incluso con un status "pendiente" (cobrada): la ausencia de
//        fianza satisface la guarda.
//        spec-delta: "Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status".
// ===========================================================================

describe('ArchivarReservasCompletadasService — sin fianza archiva (4.4)', () => {
  it('debe_archivar_con_fianza_eur_0_aunque_el_status_sea_cobrada', async () => {
    const c = candidata({ fianzaStatus: 'cobrada', fianzaEur: 0 });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.archivadas).toBe(1);
    expect(resumen.fianzaPendiente).toBe(0);
  });

  it('debe_archivar_con_fianza_eur_null_aunque_el_status_sea_cobrada', async () => {
    const c = candidata({ fianzaStatus: 'cobrada', fianzaEur: null });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.archivadas).toBe(1);
    expect(resumen.fianzaPendiente).toBe(0);
  });
});

// ===========================================================================
// 4.5 — Retención total: retenida_parcial (con fianza_devuelta_eur = 0, retención 100%) →
//        archiva. Es un estado de fianza resuelto válido.
//        spec-delta: "Retención total (retenida_parcial con importe devuelto 0) — resuelto".
// ===========================================================================

describe('ArchivarReservasCompletadasService — retención total archiva (4.5)', () => {
  it('debe_archivar_cuando_retenida_parcial_retencion_100', async () => {
    const c = candidata({ fianzaStatus: 'devuelta', fianzaEur: 500 });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(resumen.archivadas).toBe(1);
    expect(resumen.fianzaPendiente).toBe(0);
  });
});

// ===========================================================================
// 4.6 — FA-01: fianza NO resuelta en T+7d (cobrada, eur>0) → NO transiciona (no cuenta
//        como archivada), 0 auditorías de transición (la UoW no muta), y se EMITE la
//        alerta interna FA-01 (entrada de AUDIT_LOG, actor Sistema, tipo
//        fianza_pendiente_t7d, D-3=3.1). El resumen la contabiliza como fianzaPendiente.
//        spec-delta: "Fianza cobrada pero sin resolver en T+7d — no archiva y alerta".
// ===========================================================================

describe('ArchivarReservasCompletadasService — FA-01 fianza pendiente alerta (4.6)', () => {
  it('no_debe_archivar_y_debe_emitir_la_alerta_fianza_pendiente_t7d', async () => {
    const c = candidata({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    const { servicio, archivadoPort, alertaPort } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(archivadoPort.archivarReserva).toHaveBeenCalledTimes(1);
    expect(resumen.archivadas).toBe(0);
    expect(resumen.fianzaPendiente).toBe(1);
    expect(resumen.fallos).toBe(0);

    // Alerta interna al gestor (con el código de la reserva y su tenant).
    expect(alertaPort.emitir).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, tenantId: TENANT_A, codigo: c.codigo }),
    );
  });
});

// ===========================================================================
// 4.7 — Anti-duplicación de la alerta (D-4=4.2, por AUDIT_LOG): si `debeEmitir` devuelve
//        false (ya existe una alerta posterior al último cambio de fianza_status/fianza_eur)
//        → NO se re-emite la alerta, pero la RESERVA sigue contando como fianzaPendiente y
//        sin archivarse. Si `debeEmitir` devuelve true → sí se emite.
//        spec-delta: "La alerta de fianza pendiente no se duplica en barridos sucesivos".
// ===========================================================================

describe('ArchivarReservasCompletadasService — anti-duplicación de la alerta (4.7)', () => {
  it('no_debe_re_emitir_la_alerta_cuando_ya_existe_una_posterior_al_ultimo_cambio_de_fianza', async () => {
    const c = candidata({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    const { servicio, alertaPort } = montar([c], { debeEmitirAlerta: false });

    const resumen = await servicio.ejecutar();

    // Se consulta la anti-duplicación, pero NO se emite una alerta nueva.
    expect(alertaPort.debeEmitir).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitir).not.toHaveBeenCalled();
    // Sigue sin archivarse y contabilizada como fianza pendiente.
    expect(resumen.archivadas).toBe(0);
    expect(resumen.fianzaPendiente).toBe(1);
  });

  it('debe_emitir_la_alerta_cuando_no_existe_una_posterior_al_ultimo_cambio_de_fianza', async () => {
    const c = candidata({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    const { servicio, alertaPort } = montar([c], { debeEmitirAlerta: true });

    await servicio.ejecutar();

    expect(alertaPort.debeEmitir).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitir).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4.10 — FA-02 idempotencia (a nivel de aplicación): una candidata que bajo el lock YA NO
//        era post_evento (`archivada = false`, `fianzaPendiente = false`: la re-evaluación
//        de la guarda de origen la vio ya `reserva_completada`, p. ej. un pase previo o
//        US-038) → no cuenta como archivada, ni como fianza pendiente, ni como fallo, ni
//        emite alerta.
//        spec-delta: "Idempotencia del barrido — reserva ya en reserva_completada".
// ===========================================================================

describe('ArchivarReservasCompletadasService — idempotencia bajo lock (4.10)', () => {
  it('no_debe_contar_ni_alertar_una_reserva_que_dejo_de_ser_candidata_bajo_lock', async () => {
    const c = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, alertaPort } = montar([c], {
      resultados: { [c.reservaId]: 'yaCompletada' },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(1);
    expect(resumen.archivadas).toBe(0);
    expect(resumen.fianzaPendiente).toBe(0);
    expect(resumen.fallos).toBe(0);
    expect(alertaPort.emitir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4.11 — Múltiples reservas mixtas: dos resueltas → 2 archivadas (2 transiciones/auditorías
//        independientes), una fianza pendiente → alerta sin transición, una que bajo lock
//        ya estaba completada → omitida. Resumen = 2 archivadas + 1 fianzaPendiente. Cada
//        candidata se procesa en su PROPIA transacción.
//        spec-delta: "Varias reservas — resueltas archivan, pendientes alertan, ya
//        completada se omite".
// ===========================================================================

describe('ArchivarReservasCompletadasService — múltiples reservas mixtas (4.11)', () => {
  it('debe_archivar_las_dos_resueltas_alertar_la_pendiente_y_omitir_la_ya_completada', async () => {
    const ok1 = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const ok2 = candidata({ fianzaStatus: 'devuelta', fianzaEur: 200 });
    const pendiente = candidata({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    const yaCompletada = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, archivadoPort, alertaPort } = montar(
      [ok1, ok2, pendiente, yaCompletada],
      { resultados: { [yaCompletada.reservaId]: 'yaCompletada' } },
    );

    const resumen = await servicio.ejecutar();

    // Las cuatro candidatas se INTENTAN (cada una en su propia transacción).
    expect(archivadoPort.archivarReserva).toHaveBeenCalledTimes(4);
    expect(resumen.candidatas).toBe(4);
    expect(resumen.archivadas).toBe(2);
    expect(resumen.fianzaPendiente).toBe(1);
    expect(resumen.fallos).toBe(0);
    // Exactamente una alerta (la de fianza pendiente); la ya completada no alerta.
    expect(alertaPort.emitir).toHaveBeenCalledTimes(1);
    expect(alertaPort.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: pendiente.reservaId }),
    );
  });
});

// ===========================================================================
// 4.12 — Atomicidad / fallo aislado: el fallo de una candidata (excepción de su UoW) NO
//        aborta el lote; las demás se archivan; el resumen refleja el fallo aislado. Cada
//        candidata en su PROPIA transacción independiente (semántica del lote de
//        US-012/US-026/US-031).
//        spec-delta: "Un fallo parcial en una candidata no revierte las demás".
// ===========================================================================

describe('ArchivarReservasCompletadasService — fallo aislado por RESERVA (4.12)', () => {
  it('debe_archivar_las_demas_aunque_una_lance_y_reflejar_el_fallo_aislado', async () => {
    const ok1 = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const kaboom = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const ok2 = candidata({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, archivadoPort } = montar([ok1, kaboom, ok2], {
      resultados: { [kaboom.reservaId]: 'lanza' },
    });

    const resumen = await servicio.ejecutar();

    // Las tres candidatas se INTENTAN (fallo aislado, no corta el lote).
    expect(archivadoPort.archivarReserva).toHaveBeenCalledTimes(3);
    expect(resumen.candidatas).toBe(3);
    expect(resumen.archivadas).toBe(2);
    expect(resumen.fianzaPendiente).toBe(0);
    expect(resumen.fallos).toBe(1);
  });
});

// ===========================================================================
// Cross-tenant read + resumen en ceros. El barrido lista cross-tenant, pero cada archivado
// recibe el `tenantId` de SU candidata (nunca de input externo); sin candidatas → ceros.
//        spec-delta: "cross-tenant read / RLS write"; resumen agregado.
// ===========================================================================

describe('ArchivarReservasCompletadasService — cross-tenant read y resumen vacío', () => {
  it('debe_procesar_candidatas_de_varios_tenants_pasando_el_tenant_de_cada_fila', async () => {
    const a = candidata({ tenantId: TENANT_A, fianzaStatus: 'devuelta', fianzaEur: 300 });
    const b = candidata({ tenantId: TENANT_B, fianzaStatus: 'devuelta', fianzaEur: 300 });
    const { servicio, archivadoPort } = montar([a, b]);

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(2);
    expect(resumen.archivadas).toBe(2);
    expect(archivadoPort.archivarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
    expect(archivadoPort.archivarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B }),
    );
  });

  it('debe_devolver_un_resumen_en_ceros_cuando_no_hay_candidatas', async () => {
    const { servicio, archivadoPort, alertaPort } = montar([]);

    const resumen = await servicio.ejecutar();

    expect(archivadoPort.archivarReserva).not.toHaveBeenCalled();
    expect(alertaPort.emitir).not.toHaveBeenCalled();
    expect(resumen).toEqual<ResumenBarridoCompletadas>({
      candidatas: 0,
      archivadas: 0,
      fianzaPendiente: 0,
      fallos: 0,
    });
  });
});
