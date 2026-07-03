/**
 * TESTS de la OPERACIÓN DE DOMINIO PURA `planificarPromocionManualCola(...)` de US-019
 * (UC-12 FA manual) — fase TDD RED. tasks.md Fase 3: 3.1 (plan de reordenación por
 * CIERRE DE HUECO de una posición P arbitraria + validación de contigüidad/anomalía).
 *
 * Trazabilidad: US-019, spec-delta `consultas` (Requirements "Promoción manual de una
 * consulta arbitraria de la cola" — cualquier `posicion_cola`, no solo la primera;
 * "Reordenación de la cola por cierre del hueco tras la promoción manual": cada RESERVA
 * en `2d` con `posicion_cola > P` decrementa 1, las de `< P` NO cambian de posición
 * pero TODAS re-apuntan `consulta_bloqueante_id` a la nueva bloqueante; posiciones
 * contiguas desde 1; anomalía no contigua → abortar+auditar sin corrección silenciosa);
 * design.md §D-2 (plan de reordenación por "cierre de hueco", extensión del plan FIFO
 * de US-018; cuando P=1 coincide con el decremento uniforme de US-018). skill
 * `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): función determinista, sin efectos, que dado
 * el conjunto de la cola en `2.d` y el id de la RESERVA elegida por el Gestor calcula el
 * PLAN declarativo: la mutación de la promovida (2d→2b, `posicion_cola`/
 * `consulta_bloqueante_id → NULL`) + los reordenamientos de los restantes (cierre de
 * hueco). Reutiliza la guarda declarativa `resolverPromocionCola` de US-018 (solo
 * `2.d` es promovible). NO muta la entrada.
 *
 * DIFERENCIA con `planificarPromocionCola` de US-018: US-018 promueve SIEMPRE la
 * posición 1 (FIFO). US-019 promueve una posición P ARBITRARIA (la elegida por el
 * Gestor) y cierra el hueco: `> P` decrementa, `< P` conserva posición.
 *
 * RED: aún NO existen `planificarPromocionManualCola`, `PlanPromocionManualCola` ni sus
 * tipos en `reservas/domain/promocion-manual-cola.ts`. Los imports/símbolos fallan y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  planificarPromocionManualCola,
  type EntradaColaManual,
  type PlanPromocionManualCola,
} from '../domain/promocion-manual-cola';

const bloqueanteVivaId = 'R1';

const entrada = (over: Partial<EntradaColaManual>): EntradaColaManual => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  subEstado: '2d',
  posicionCola: 1,
  consultaBloqueanteId: bloqueanteVivaId,
  ...over,
});

// ===========================================================================
// 1. Promover una posición INTERMEDIA (P=2) cierra el hueco: la de posición < P
//    conserva su posición (re-apunta a la nueva bloqueante); la de posición > P
//    decrementa 1 (re-apunta también).
//    spec-delta: "R3 → 2b (nueva bloqueante); R2: posicion_cola → 1, cierra el hueco,
//    consulta_bloqueante_id → R3.id; posiciones contiguas desde 1".
// ===========================================================================

describe('planificarPromocionManualCola — promover posición intermedia cierra el hueco', () => {
  it('debe_promover_R3_conservar_R2_en_1_y_decrementar_R4_reapuntando_a_R3', () => {
    // Cola: R2 (pos 1), R3 (pos 2, ELEGIDA), R4 (pos 3). Todas apuntan a la bloqueante R1.
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 });

    const plan = planificarPromocionManualCola([r2, r3, r4], 'R3');

    expect(plan.anomalia).toBe(false);
    expect(plan.promovida).toEqual({
      reservaId: 'R3',
      estadoDestino: 'consulta',
      subEstadoDestino: '2b',
      posicionColaDestino: null,
      consultaBloqueanteIdDestino: null,
    });
    // R2 (pos 1 < P=2): CONSERVA la posición 1 pero re-apunta a la nueva bloqueante R3.
    // R4 (pos 3 > P=2): decrementa a 2 y re-apunta a R3.
    expect(plan.reordenamientos).toEqual([
      { reservaId: 'R2', posicionColaDestino: 1, consultaBloqueanteIdDestino: 'R3' },
      { reservaId: 'R4', posicionColaDestino: 2, consultaBloqueanteIdDestino: 'R3' },
    ]);
  });

  it('debe_dejar_posiciones_contiguas_empezando_en_1_tras_cerrar_el_hueco', () => {
    // Cola de 4; se promueve la posición 3 (R4). R2/R3 conservan 1/2; R5 decrementa a 3.
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
      entrada({ reservaId: 'R4', posicionCola: 3 }),
      entrada({ reservaId: 'R5', posicionCola: 4 }),
    ];

    const plan = planificarPromocionManualCola(cola, 'R4');

    const posiciones = plan.reordenamientos
      .map((r: PlanPromocionManualCola['reordenamientos'][number]) => r.posicionColaDestino)
      .sort((a: number, b: number) => a - b);
    expect(posiciones).toEqual([1, 2, 3]);
    // Todos re-apuntan a la nueva bloqueante R4.
    expect(
      plan.reordenamientos.every(
        (r: PlanPromocionManualCola['reordenamientos'][number]) =>
          r.consultaBloqueanteIdDestino === 'R4',
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// 2. Promover la PRIMERA (P=1): coincide con el decremento uniforme FIFO de US-018.
//    spec-delta FA-01: "El Gestor promueve la primera de la cola (posicion_cola = 1)".
// ===========================================================================

describe('planificarPromocionManualCola — promover P=1 equivale al decremento FIFO', () => {
  it('debe_promover_R2_y_decrementar_R3_R4_reapuntando_a_R2', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 });

    const plan = planificarPromocionManualCola([r2, r3, r4], 'R2');

    expect(plan.anomalia).toBe(false);
    expect(plan.promovida?.reservaId).toBe('R2');
    expect(plan.reordenamientos).toEqual([
      { reservaId: 'R3', posicionColaDestino: 1, consultaBloqueanteIdDestino: 'R2' },
      { reservaId: 'R4', posicionColaDestino: 2, consultaBloqueanteIdDestino: 'R2' },
    ]);
  });
});

// ===========================================================================
// 3. Promover la ÚLTIMA (P = N): nadie decrementa; los de posición < P conservan su
//    posición y solo re-apuntan a la nueva bloqueante.
// ===========================================================================

describe('planificarPromocionManualCola — promover la última no decrementa a nadie', () => {
  it('debe_conservar_las_posiciones_de_los_anteriores_reapuntando_a_la_promovida', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 }); // última, ELEGIDA.

    const plan = planificarPromocionManualCola([r2, r3, r4], 'R4');

    expect(plan.promovida?.reservaId).toBe('R4');
    expect(plan.reordenamientos).toEqual([
      { reservaId: 'R2', posicionColaDestino: 1, consultaBloqueanteIdDestino: 'R4' },
      { reservaId: 'R3', posicionColaDestino: 2, consultaBloqueanteIdDestino: 'R4' },
    ]);
  });
});

// ===========================================================================
// 4. Cola de UN elemento (FA-03): promover el único deja la cola VACÍA (sin
//    reordenamientos).
//    spec-delta: "Cola de un único elemento queda vacía tras la promoción (FA-03)".
// ===========================================================================

describe('planificarPromocionManualCola — cola de un único elemento (FA-03)', () => {
  it('debe_promover_el_unico_y_dejar_la_cola_vacia_sin_reordenar', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });

    const plan = planificarPromocionManualCola([r2], 'R2');

    expect(plan).toEqual<PlanPromocionManualCola>({
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
// 5. GUARDA de origen (FA-05): la RESERVA elegida NO está en la cola en `2.d` → el
//    plan la marca como anomalía (no promovible), para que la aplicación rechace sin
//    efectos. Reutiliza la guarda declarativa `resolverPromocionCola` de US-018.
//    spec-delta: "solo {consulta,2d} es promovible".
// ===========================================================================

describe('planificarPromocionManualCola — la elegida debe estar en la cola en 2.d', () => {
  it('debe_marcar_anomalia_cuando_la_elegida_no_pertenece_a_la_cola', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });

    // El Gestor pide promover R9, que NO está en la cola leída bajo lock.
    const plan = planificarPromocionManualCola([r2, r3], 'R9');

    expect(plan.anomalia).toBe(true);
    expect(plan.promovida).toBeNull();
  });

  it('debe_marcar_anomalia_cuando_la_elegida_esta_en_la_cola_pero_no_en_2d', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    // R3 aparece en el conjunto pero con un sub-estado NO promovible (ya no en cola).
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2, subEstado: '2x' });

    const plan = planificarPromocionManualCola([r2, r3], 'R3');

    expect(plan.anomalia).toBe(true);
    expect(plan.promovida).toBeNull();
  });
});

// ===========================================================================
// 6. ANOMALÍA de posiciones NO contiguas (hueco/no-arranca-en-1/duplicadas): el plan
//    la marca para que la aplicación audite + aborte SIN corrección silenciosa (mismo
//    criterio que US-018).
//    spec-delta: "Si al leer la cola bajo lock las posiciones no son contiguas … abortar".
// ===========================================================================

describe('planificarPromocionManualCola — anomalía de posiciones no contiguas', () => {
  it('debe_marcar_anomalia_cuando_falta_una_posicion_intermedia', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 }); // falta la posición 2.

    const plan = planificarPromocionManualCola([r2, r4], 'R2');

    expect(plan.anomalia).toBe(true);
  });

  it('debe_marcar_anomalia_cuando_no_arranca_en_1', () => {
    const r3 = entrada({ reservaId: 'R3', posicionCola: 2 });
    const r4 = entrada({ reservaId: 'R4', posicionCola: 3 }); // no hay posición 1.

    const plan = planificarPromocionManualCola([r3, r4], 'R3');

    expect(plan.anomalia).toBe(true);
  });

  it('debe_marcar_anomalia_cuando_hay_posiciones_duplicadas', () => {
    const r2 = entrada({ reservaId: 'R2', posicionCola: 1 });
    const r2bis = entrada({ reservaId: 'R2bis', posicionCola: 1 }); // duplicada.

    const plan = planificarPromocionManualCola([r2, r2bis], 'R2');

    expect(plan.anomalia).toBe(true);
  });
});

// ===========================================================================
// 7. Cola VACÍA (defensivo): sin candidatos no hay promoción posible → anomalía (el
//    Gestor no puede promover de una cola vacía; la aplicación rechaza sin efectos).
// ===========================================================================

describe('planificarPromocionManualCola — cola vacía no es promovible', () => {
  it('debe_marcar_anomalia_cuando_la_cola_esta_vacia', () => {
    const plan = planificarPromocionManualCola([], 'R2');

    expect(plan.anomalia).toBe(true);
    expect(plan.promovida).toBeNull();
    expect(plan.reordenamientos).toEqual([]);
  });
});

// ===========================================================================
// 8. PUREZA: no muta la entrada ni depende de estado externo (determinista).
// ===========================================================================

describe('planificarPromocionManualCola — función pura (sin efectos, determinista)', () => {
  it('no_debe_mutar_el_array_de_entrada', () => {
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
    ];
    const copia = cola.map((c) => ({ ...c }));

    planificarPromocionManualCola(cola, 'R3');

    expect(cola).toEqual(copia);
  });

  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const cola = [
      entrada({ reservaId: 'R2', posicionCola: 1 }),
      entrada({ reservaId: 'R3', posicionCola: 2 }),
    ];
    expect(planificarPromocionManualCola(cola, 'R3')).toEqual(
      planificarPromocionManualCola(cola, 'R3'),
    );
  });
});
