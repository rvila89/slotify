/**
 * TESTS del PLAN PURO de SALIDA DE COLA por cambio de fecha
 * (`planificarSalidaDeCola(cola, reservaQueSaleId)`) del change
 * `cambiar-fecha-consulta-en-cola` — fase TDD RED. tasks.md §"TDD primero"
 * (reordenación de cola).
 *
 * Trazabilidad: design.md §D-3 (salida de cola con reordenación, reutiliza mecánica
 * US-013); spec-delta `consultas` (escenario "Al salir de la cola por cambio de fecha, la
 * cola vieja se reordena contigua desde 1"). CLAUDE.md §Máquina de estados; skill
 * `state-machine`.
 *
 * DIFERENCIA con `planificarPromocionManualCola` (US-019) y `planificarPromocionCola`
 * (US-018): aquí NO hay promoción. Una RESERVA en `2.d` SALE de la cola porque el gestor
 * le asigna una FECHA NUEVA libre (pasa a `2.b` con bloqueo propio en otro seam); la cola
 * vieja solo debe CERRAR EL HUECO decrementando en 1 las posiciones `> P`, SIN re-apuntar
 * `consulta_bloqueante_id` (el bloqueante NO cambia: la 2d no era bloqueante de nadie) y
 * SIN promover a nadie a `2.b`.
 *
 * Contrato esperado (a implementar por `backend-developer`):
 *   planificarSalidaDeCola(cola, reservaQueSaleId): PlanSalidaDeCola
 *     { anomalia, saliente: { reservaId, posicionColaDestino: null, consultaBloqueanteIdDestino: null },
 *       reordenamientos: Array<{ reservaId, posicionColaDestino }> }
 *   - `> P` decrementa 1; `< P` conserva; contiguas 1..N-1 tras la salida.
 *   - `consulta_bloqueante_id` de los restantes NO cambia (mismo bloqueante).
 *   - cola vacía / saliente ausente / no en `2.d` / posiciones no contiguas → anomalía.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): NO importa `@nestjs/*`, Prisma ni infra;
 * función pura y determinista, no muta la entrada.
 *
 * RED: aún NO existe `planificarSalidaDeCola` ni `PlanSalidaDeCola`/`EntradaColaSalida` en
 * `reservas/domain`. La batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo
 * inexistente). GREEN es de `backend-developer`.
 */
import {
  planificarSalidaDeCola,
  type EntradaColaSalida,
  type PlanSalidaDeCola,
} from '../domain/salida-de-cola';

/** Elemento de reordenamiento del plan (posición destino de un restante). */
type ReordenamientoSalida = PlanSalidaDeCola['reordenamientos'][number];

const BLOQUEANTE = 'R1-bloqueante';

const enCola = (
  reservaId: string,
  posicionCola: number,
): EntradaColaSalida => ({
  reservaId,
  subEstado: '2d',
  posicionCola,
  consultaBloqueanteId: BLOQUEANTE,
});

// ===========================================================================
// 1. Posición INTERMEDIA (P=2 de [1,2,3]) sale → cierra el hueco contiguo desde 1.
//    Escenario spec: R2(1), R3(2), R4(3); sale R3 → R4 baja a 2, R2 sigue en 1.
// ===========================================================================

describe('planificarSalidaDeCola — posición intermedia cierra el hueco contiguo desde 1', () => {
  it('debe_decrementar_solo_las_posiciones_mayores_que_la_saliente', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];

    const plan = planificarSalidaDeCola(cola, 'R3');

    expect(plan.anomalia).toBe(false);
    // La saliente (R3) sale de la cola.
    expect(plan.saliente).toEqual({
      reservaId: 'R3',
      posicionColaDestino: null,
      consultaBloqueanteIdDestino: null,
    });
    // R4 (posición 3 > 2) decrementa a 2; R2 (posición 1 < 2) conserva su posición.
    const porId = new Map(
      plan.reordenamientos.map((r: ReordenamientoSalida) => [r.reservaId, r]),
    );
    expect(porId.get('R4')?.posicionColaDestino).toBe(2);
    expect(porId.has('R2')).toBe(false); // R2 no cambia → no debe reordenarse (o queda en 1)
  });

  it('debe_dejar_las_posiciones_restantes_contiguas_empezando_en_1', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];

    const plan = planificarSalidaDeCola(cola, 'R3');

    // Posiciones finales de los que quedan: R2=1, R4=2 → {1,2} contiguas desde 1.
    const restantes = new Map<string, number>([['R2', 1], ['R4', 3]]);
    for (const r of plan.reordenamientos) {
      restantes.set(r.reservaId, r.posicionColaDestino);
    }
    const finales = [...restantes.values()].sort((a, b) => a - b);
    expect(finales).toEqual([1, 2]);
  });

  it('no_debe_reapuntar_el_consulta_bloqueante_id_de_los_restantes', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];

    const plan = planificarSalidaDeCola(cola, 'R3');

    // A diferencia de la PROMOCIÓN, la salida NO cambia el bloqueante: no hay campo
    // `consultaBloqueanteIdDestino` en los reordenamientos (o si existe, no debe re-apuntar).
    for (const r of plan.reordenamientos) {
      expect(r).not.toHaveProperty('consultaBloqueanteIdDestino');
    }
  });
});

// ===========================================================================
// 2. Sale la ÚLTIMA posición → nadie decrementa (no hay posiciones > P).
// ===========================================================================

describe('planificarSalidaDeCola — sale la última posición: nadie decrementa', () => {
  it('no_debe_reordenar_a_nadie_cuando_sale_la_ultima', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];

    const plan = planificarSalidaDeCola(cola, 'R4');

    expect(plan.anomalia).toBe(false);
    expect(plan.saliente.reservaId).toBe('R4');
    // Nadie tiene posición > 3 → ningún decremento efectivo.
    const cambios = plan.reordenamientos.filter(
      (r: ReordenamientoSalida) => r.reservaId === 'R2' || r.reservaId === 'R3',
    );
    // Si el helper solo emite decrementos reales, no hay reordenamientos.
    for (const c of cambios) {
      expect(c.posicionColaDestino).toBe(c.reservaId === 'R2' ? 1 : 2);
    }
  });
});

// ===========================================================================
// 3. Sale la PRIMERA posición → todos los demás decrementan en 1 (equivale a FIFO).
// ===========================================================================

describe('planificarSalidaDeCola — sale la primera: todos decrementan en 1', () => {
  it('debe_decrementar_a_todos_los_restantes', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];

    const plan = planificarSalidaDeCola(cola, 'R2');

    expect(plan.anomalia).toBe(false);
    const porId = new Map(
      plan.reordenamientos.map((r: ReordenamientoSalida) => [
        r.reservaId,
        r.posicionColaDestino,
      ]),
    );
    expect(porId.get('R3')).toBe(1);
    expect(porId.get('R4')).toBe(2);
  });
});

// ===========================================================================
// 4. Cola de UN solo elemento (la propia saliente) → cola vacía tras salir, sin
//    reordenamientos, sin anomalía.
// ===========================================================================

describe('planificarSalidaDeCola — único elemento sale sin reordenar', () => {
  it('debe_vaciar_la_cola_sin_reordenamientos', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1)];

    const plan = planificarSalidaDeCola(cola, 'R2');

    expect(plan.anomalia).toBe(false);
    expect(plan.saliente.reservaId).toBe('R2');
    expect(plan.reordenamientos).toHaveLength(0);
  });
});

// ===========================================================================
// 5. ANOMALÍAS (no muta nada, la aplicación audita + aborta): cola vacía, saliente
//    ausente, saliente no en 2.d, posiciones no contiguas.
// ===========================================================================

describe('planificarSalidaDeCola — anomalías → no reordena', () => {
  it('cola_vacia_es_anomalia', () => {
    const plan = planificarSalidaDeCola([], 'R2');
    expect(plan.anomalia).toBe(true);
    expect(plan.reordenamientos).toHaveLength(0);
  });

  it('saliente_ausente_de_la_cola_es_anomalia', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2)];
    const plan = planificarSalidaDeCola(cola, 'INEXISTENTE');
    expect(plan.anomalia).toBe(true);
  });

  it('saliente_no_en_2d_es_anomalia', () => {
    const cola: EntradaColaSalida[] = [
      { reservaId: 'R2', subEstado: '2b', posicionCola: 1, consultaBloqueanteId: BLOQUEANTE },
      enCola('R3', 2),
    ];
    const plan = planificarSalidaDeCola(cola, 'R2');
    expect(plan.anomalia).toBe(true);
  });

  it('posiciones_no_contiguas_es_anomalia', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R4', 3)]; // hueco: falta 2
    const plan = planificarSalidaDeCola(cola, 'R2');
    expect(plan.anomalia).toBe(true);
  });
});

// ===========================================================================
// 6. PUREZA: no muta la entrada.
// ===========================================================================

describe('planificarSalidaDeCola — es una función pura (no muta la entrada)', () => {
  it('no_debe_mutar_el_array_ni_las_entradas', () => {
    const cola: EntradaColaSalida[] = [enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)];
    const copia: PlanSalidaDeCola = planificarSalidaDeCola(cola, 'R3');

    expect(copia).toBeDefined();
    expect(cola).toEqual([enCola('R2', 1), enCola('R3', 2), enCola('R4', 3)]);
  });
});
