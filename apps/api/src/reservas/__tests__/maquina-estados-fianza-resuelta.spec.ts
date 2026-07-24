/**
 * TESTS de la GUARDA PURA DE FIANZA RESUELTA del archivado automático
 * (`fianzaResuelta({ fianzaStatus, fianzaEur })`) de US-037 (UC-28) — fase TDD RED.
 * tasks.md Fase 4: 4.2.
 *
 * Trazabilidad: US-037, spec-delta `consultas` (Requirement "Transición atómica a
 * reserva_completada solo con la guarda de fianza resuelta"; escenarios "Sin fianza
 * (fianza_eur = 0 o NULL)", "Retención total (retenida_parcial con importe devuelto 0)")
 * y "Fianza no resuelta en T+7d"; design.md §D-6 (guarda de fianza como función de
 * dominio PURA, NO `if` dispersos, que además indica si está PENDIENTE para poblar la
 * alerta de FA-01). CLAUDE.md §Máquina de estados; skill `state-machine`.
 *
 * REGLA (D-6 / gate D-3+D-4): la fianza está RESUELTA si
 *   `fianzaStatus ∈ {devuelta, retenida_parcial}` O `fianzaEur <= 0` O `fianzaEur == null`.
 * `retenida_parcial` con `fianzaDevueltaEur = 0` (retención 100%) es RESUELTO (no se
 * distingue del importe > 0; el importe devuelto NO entra en esta guarda). Cuando la
 * fianza NO está resuelta, la guarda devuelve además `pendiente = true` para alimentar la
 * alerta interna de FA-01 (fianza_pendiente_t7d) sin lógica dispersa.
 *
 * MATRIZ (fianzaStatus × fianzaEur):
 *                         fianzaEur=0   fianzaEur=null   fianzaEur>0
 *   devuelta              resuelta      resuelta         resuelta
 *   retenida_parcial      resuelta      resuelta         resuelta
 *   cobrada               resuelta*     resuelta*        PENDIENTE
 *   pendiente             resuelta*     resuelta*        PENDIENTE
 *   recibo_enviado        resuelta*     resuelta*        PENDIENTE
 *   (*) sin fianza (eur<=0 o null) → resuelta con INDEPENDENCIA del status (no se evalúa).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): función determinista y sin efectos. No se
 * importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. Se re-evalúa DENTRO de la transacción bajo el lock.
 *
 * RED: aún NO existen `fianzaResuelta`, `ResultadoFianzaResuelta` ni el tipo de entrada en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (símbolo inexistente). GREEN es de `backend-developer`.
 */
import {
  fianzaResuelta,
  type FianzaStatusDominio,
  type ResultadoFianzaResuelta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. fianzaStatus resolutivo ({devuelta, retenida_parcial}) con importe > 0 → RESUELTA.
//    spec-delta: "fianza_status ∈ {devuelta, retenida_parcial}" satisface la guarda.
// ===========================================================================

describe('fianzaResuelta — status resolutivo con importe > 0', () => {
  it('debe_estar_resuelta_cuando_devuelta_con_importe_positivo', () => {
    const r = fianzaResuelta({ fianzaStatus: 'devuelta', fianzaEur: 300 });
    expect(r).toEqual<ResultadoFianzaResuelta>({ resuelta: true, pendiente: false });
  });

  it('debe_estar_resuelta_cuando_devuelta_con_importe_alto', () => {
    const r = fianzaResuelta({ fianzaStatus: 'devuelta', fianzaEur: 900 });
    expect(r).toEqual<ResultadoFianzaResuelta>({ resuelta: true, pendiente: false });
  });
});

// ===========================================================================
// 2. Retención TOTAL (retenida_parcial, retención del 100%): la guarda NO mira el importe
//    devuelto — retenida_parcial con importe cobrado > 0 es RESUELTA igualmente. (El
//    fianza_devuelta_eur = 0 vive en la fila, no en esta guarda; se documenta el caso.)
//    spec-delta: "Retención total (retenida_parcial con importe devuelto 0) — resuelto".
// ===========================================================================

describe('fianzaResuelta — devuelta es estado resuelto con cualquier importe', () => {
  it('debe_estar_resuelta_cuando_devuelta_con_importe_cobrado_positivo', () => {
    const r = fianzaResuelta({ fianzaStatus: 'devuelta', fianzaEur: 500 });
    expect(r.resuelta).toBe(true);
    expect(r.pendiente).toBe(false);
  });
});

// ===========================================================================
// 3. Sin fianza (fianzaEur <= 0 O null): RESUELTA con INDEPENDENCIA de fianzaStatus (no se
//    evalúa el status). Incluye el status más "pendiente" posible.
//    spec-delta: "Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status".
// ===========================================================================

describe('fianzaResuelta — sin fianza (eur<=0 o null) satisface la guarda sin mirar el status', () => {
  const todosLosStatus: ReadonlyArray<FianzaStatusDominio> = [
    'pendiente',
    'cobrada',
    'devuelta',
  ];

  it.each(todosLosStatus)(
    'debe_estar_resuelta_con_fianzaEur_0_aunque_el_status_sea_%s',
    (fianzaStatus) => {
      const r = fianzaResuelta({ fianzaStatus, fianzaEur: 0 });
      expect(r.resuelta).toBe(true);
      expect(r.pendiente).toBe(false);
    },
  );

  it.each(todosLosStatus)(
    'debe_estar_resuelta_con_fianzaEur_null_aunque_el_status_sea_%s',
    (fianzaStatus) => {
      const r = fianzaResuelta({ fianzaStatus, fianzaEur: null });
      expect(r.resuelta).toBe(true);
      expect(r.pendiente).toBe(false);
    },
  );

  it('debe_estar_resuelta_con_fianzaEur_negativo_caso_defensivo', () => {
    // Un negativo (dato anómalo) colapsa a "sin fianza" (eur <= 0): resuelta.
    const r = fianzaResuelta({ fianzaStatus: 'cobrada', fianzaEur: -1 });
    expect(r.resuelta).toBe(true);
  });
});

// ===========================================================================
// 4. FIANZA PENDIENTE (FA-01): status NO resolutivo ({cobrada, pendiente, recibo_enviado})
//    CON importe > 0 → NO resuelta y `pendiente = true` (dispara la alerta interna).
//    spec-delta: "Fianza cobrada pero sin resolver en T+7d — no archiva y alerta".
// ===========================================================================

describe('fianzaResuelta — status no resolutivo con importe > 0 está PENDIENTE (FA-01)', () => {
  const statusPendientes: ReadonlyArray<FianzaStatusDominio> = ['cobrada', 'pendiente'];

  it.each(statusPendientes)(
    'no_debe_estar_resuelta_cuando_status_%s_con_importe_positivo_y_debe_marcar_pendiente',
    (fianzaStatus) => {
      const r = fianzaResuelta({ fianzaStatus, fianzaEur: 300 });
      expect(r).toEqual<ResultadoFianzaResuelta>({ resuelta: false, pendiente: true });
    },
  );
});

// ===========================================================================
// 5. Determinismo (función pura): misma entrada → mismo resultado; sin efectos.
// ===========================================================================

describe('fianzaResuelta — determinismo (función pura)', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = fianzaResuelta({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    const b = fianzaResuelta({ fianzaStatus: 'cobrada', fianzaEur: 300 });
    expect(a).toEqual(b);
  });
});
