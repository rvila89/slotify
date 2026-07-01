/**
 * TESTS de la OPERACIÓN DE DOMINIO PURA `planificarPromocionCola(...)` de US-018
 * (UC-12, A15) — fase TDD RED. tasks.md Fase 3: 3.1 (cálculo del plan) y 3.4
 * (validación de contigüidad).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirements "Reordenación FIFO del
 * resto de la cola tras la promoción", "Cola de un único elemento", "Anomalía de
 * posiciones no contiguas — abortar y auditar sin corrección silenciosa"); design.md
 * §D-2 (dominio puro: dados los datos de la cola leídos por el puerto — candidato
 * `posicion_cola = 1` + restantes — calcula el PLAN de promoción: mutaciones de la
 * promovida + decrementos + nuevo `consulta_bloqueante_id`, y valida la contigüidad
 * de posiciones; sin efectos), §D-8. skill `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): función sin efectos que dado el estado de
 * la cola produce un PLAN declarativo. La contigüidad (posiciones 1..N sin huecos) se
 * valida aquí; si hay hueco, el plan es una ANOMALÍA a auditar+abortar (NO se corrige
 * silenciosamente).
 *
 * RED: aún NO existen `planificarPromocionCola`, `EntradaCola`, `PlanPromocionCola`
 * ni sus tipos en `reservas/domain/promocion-cola.ts`. Los imports/símbolos fallan y
 * la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  planificarPromocionCola,
  type EntradaCola,
  type PlanPromocionCola,
} from '../domain/promocion-cola';

const bloqueanteLiberadaId = 'R1';

const entrada = (over: Partial<EntradaCola>): EntradaCola => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  subEstado: '2d',
  posicionCola: 1,
  consultaBloqueanteId: bloqueanteLiberadaId,
  ...over,
});

// ===========================================================================
// 1. Cola de UN elemento (FA-01): promueve R2 y deja la cola VACÍA (sin
//    reordenación de restantes, no los hay).
//    spec-delta: "Cola de un único elemento — promoción deja la cola vacía".
// ===========================================================================

describe('planificarPromocionCola — cola de un único elemento (FA-01)', () => {
  it('debe_promover_el_unico_en_cola_y_dejar_la_cola_vacia_sin_reordenar', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });

    const plan = planificarPromocionCola([r2]);

    expect(plan).toEqual<PlanPromocionCola>({
      anomalia: false,
      promovida: {
        reservaId: 'R2',
        estadoDestino: 'consulta',
        subEstadoDestino: '2b',
        posicionColaDestino: null,
        consultaBloqueanteIdDestino: null,
      },
      reordenamientos: [],
    });
  });
});

// ===========================================================================
// 2. Cola de MÁS de dos elementos (FA-03): promueve el primero, decrementa el
//    resto en 1 y re-apunta su `consulta_bloqueante_id` a la nueva bloqueante (R2).
//    spec-delta: "Cola de más de dos elementos reordena y re-apunta a la nueva
//    bloqueante".
// ===========================================================================

describe('planificarPromocionCola — cola de más de dos elementos (FA-03)', () => {
  it('debe_promover_el_primero_decrementar_el_resto_y_re_apuntar_a_la_nueva_bloqueante', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 });

    const plan = planificarPromocionCola([r2, r3, r4]);

    expect(plan.anomalia).toBe(false);
    expect(plan.promovida).toEqual({
      reservaId: 'R2',
      estadoDestino: 'consulta',
      subEstadoDestino: '2b',
      posicionColaDestino: null,
      consultaBloqueanteIdDestino: null,
    });
    // R3 → posición 1, R4 → posición 2, ambos apuntando a la nueva bloqueante R2.
    expect(plan.reordenamientos).toEqual([
      { reservaId: 'R3', posicionColaDestino: 1, consultaBloqueanteIdDestino: 'R2' },
      { reservaId: 'R4', posicionColaDestino: 2, consultaBloqueanteIdDestino: 'R2' },
    ]);
  });

  it('debe_producir_posiciones_contiguas_empezando_en_1_tras_reordenar', () => {
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
      entrada({ reservaId: 'R4', posicionCola: 3 }),
      entrada({ reservaId: 'R5', posicionCola: 4 }),
    ];

    const plan = planificarPromocionCola(cola);

    const posiciones = plan.reordenamientos.map(
      (r: PlanPromocionCola['reordenamientos'][number]) => r.posicionColaDestino,
    );
    expect(posiciones).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// 3. Entrada DESORDENADA pero CONTIGUA: el plan promueve por posicion_cola = 1
//    (no por orden del array). La selección del candidato es por FIFO estricto.
// ===========================================================================

describe('planificarPromocionCola — selecciona el candidato por posicion_cola = 1 (FIFO)', () => {
  it('debe_promover_al_de_posicion_1_aunque_llegue_desordenado_en_el_array', () => {
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 });
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });

    const plan = planificarPromocionCola([r4, r2, r3]);

    expect(plan.anomalia).toBe(false);
    expect(plan.promovida?.reservaId).toBe('R2');
    expect(plan.reordenamientos).toEqual([
      { reservaId: 'R3', posicionColaDestino: 1, consultaBloqueanteIdDestino: 'R2' },
      { reservaId: 'R4', posicionColaDestino: 2, consultaBloqueanteIdDestino: 'R2' },
    ]);
  });
});

// ===========================================================================
// 4. ANOMALÍA de posiciones NO contiguas (hueco): el plan la marca como anomalía
//    para que el caso de uso audite + aborte SIN corregir silenciosamente.
//    spec-delta: "Anomalía de posiciones no contiguas — abortar y auditar".
// ===========================================================================

describe('planificarPromocionCola — anomalía de posiciones no contiguas', () => {
  it('debe_marcar_anomalia_cuando_falta_una_posicion_intermedia_1_3_sin_2', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 }); // falta la posición 2.

    const plan = planificarPromocionCola([r2, r4]);

    expect(plan.anomalia).toBe(true);
  });

  it('debe_marcar_anomalia_cuando_no_arranca_en_1', () => {
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 }); // no hay posición 1.

    const plan = planificarPromocionCola([r3, r4]);

    expect(plan.anomalia).toBe(true);
  });

  it('debe_marcar_anomalia_cuando_hay_posiciones_duplicadas', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r2bis = entrada({ reservaId: 'R2bis', posicionCola: 1 }); // duplicada.

    const plan = planificarPromocionCola([r2, r2bis]);

    expect(plan.anomalia).toBe(true);
  });
});

// ===========================================================================
// 5. Cola VACÍA (FA-02, defensivo): sin candidato no hay promoción; el plan es un
//    no-op explícito (sin promovida). El caso de uso lo trata como no-op sin error.
// ===========================================================================

describe('planificarPromocionCola — cola vacía es no-op (FA-02 defensivo)', () => {
  it('debe_devolver_un_plan_sin_promovida_cuando_la_cola_esta_vacia', () => {
    const plan = planificarPromocionCola([]);

    expect(plan.anomalia).toBe(false);
    expect(plan.promovida).toBeNull();
    expect(plan.reordenamientos).toEqual([]);
  });
});

// ===========================================================================
// 6. PUREZA: no muta la entrada ni depende de estado externo (determinista).
// ===========================================================================

describe('planificarPromocionCola — función pura (sin efectos, determinista)', () => {
  it('no_debe_mutar_el_array_de_entrada', () => {
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
    ];
    const copia = cola.map((c) => ({ ...c }));

    planificarPromocionCola(cola);

    expect(cola).toEqual(copia);
  });

  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
    ];
    expect(planificarPromocionCola(cola)).toEqual(planificarPromocionCola(cola));
  });
});
