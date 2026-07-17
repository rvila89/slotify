/**
 * TESTS de la GUARDA DE FECHA PURA `esDiaDelEvento(fechaEvento, hoy)` del FORZADO
 * MANUAL del inicio de evento (US-032 / UC-23 FA-01, actor Gestor) — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-032, spec-delta `consultas` (Requirement "El forzado solo está
 * disponible el día del evento (fecha_evento = hoy)"), design.md §D-2:
 *   - La guarda de fecha vive en el DOMINIO PURO (`maquina-estados.ts`) como función
 *     `esDiaDelEvento(fechaEvento: Date, hoy: Date): boolean` que compara por FECHA DE
 *     CALENDARIO (año-mes-día), NO por instante. Es una PRECONDICIÓN sobre el estado
 *     actual del agregado (como `esEstadoValidoParaEditarPresupuesto`), no una arista de
 *     la máquina de estados.
 *   - Blinda el off-by-one de TZ: un evento de HOY a las 23:00 sigue siendo "hoy"; el
 *     cambio de día de calendario (ayer/mañana) da `false` con independencia de la hora.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una función pura y determinista.
 * No se importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. Se invoca en el use-case (tras la guarda de
 * origen `resolverInicioEvento`) para rechazar con 422 un forzado fuera del día del evento.
 *
 * RED: aún NO existe `esDiaDelEvento` en `reservas/domain/maquina-estados.ts`. La batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import { esDiaDelEvento } from '../domain/maquina-estados';

/**
 * Construye un `Date` en la fecha de calendario `hoy + offsetDias` a la hora indicada.
 * Se deriva SIEMPRE de la misma "ahora" para evitar carreras de medianoche en el test.
 */
const conOffset = (base: Date, offsetDias: number, hora: number, min = 0): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDias);
  d.setHours(hora, min, 0, 0);
  return d;
};

// ===========================================================================
// 1. Matriz {ayer, hoy, mañana}: solo el MISMO día de calendario que `hoy` es true.
//    spec-delta: "date(fecha_evento) = date(hoy)".
// ===========================================================================

describe('esDiaDelEvento — matriz ayer / hoy / mañana', () => {
  it('debe_devolver_true_cuando_el_evento_es_hoy', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 12);
    const evento = conOffset(ahora, 0, 12);
    expect(esDiaDelEvento(evento, hoy)).toBe(true);
  });

  it('debe_devolver_false_cuando_el_evento_fue_ayer', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 12);
    const evento = conOffset(ahora, -1, 12);
    expect(esDiaDelEvento(evento, hoy)).toBe(false);
  });

  it('debe_devolver_false_cuando_el_evento_es_manana', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 12);
    const evento = conOffset(ahora, 1, 12);
    expect(esDiaDelEvento(evento, hoy)).toBe(false);
  });
});

// ===========================================================================
// 2. Comparación por FECHA DE CALENDARIO (no por instante): mismo año-mes-día con
//    distinta hora → true. Blindaje off-by-one de TZ (evento de hoy a las 23:00 → true;
//    de hoy a las 00:00 → true).
//    spec-delta: "comparación por fecha de calendario del evento (no por instante)".
// ===========================================================================

describe('esDiaDelEvento — mismo día de calendario con distinta hora es true', () => {
  it('debe_ser_true_para_el_mismo_dia_aunque_las_horas_difieran', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 9, 30);
    const eventoNoche = conOffset(ahora, 0, 23, 59);
    expect(esDiaDelEvento(eventoNoche, hoy)).toBe(true);
  });

  it('debe_ser_true_para_evento_a_medianoche_del_mismo_dia', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 17);
    const eventoMedianoche = conOffset(ahora, 0, 0, 0);
    expect(esDiaDelEvento(eventoMedianoche, hoy)).toBe(true);
  });

  it('no_debe_confundir_el_final_de_hoy_con_el_inicio_de_manana', () => {
    const ahora = new Date();
    const hoy = conOffset(ahora, 0, 23, 59);
    const eventoManana = conOffset(ahora, 1, 0, 1);
    // El instante está a ~2 minutos, pero es OTRA fecha de calendario → false.
    expect(esDiaDelEvento(eventoManana, hoy)).toBe(false);
  });
});

// ===========================================================================
// 3. Determinismo: misma entrada → mismo resultado (función pura, sin efectos).
// ===========================================================================

describe('esDiaDelEvento — determinismo', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const hoy = new Date('2026-09-12T10:00:00.000Z');
    const evento = new Date('2026-09-12T20:00:00.000Z');
    const a = esDiaDelEvento(evento, hoy);
    const b = esDiaDelEvento(evento, hoy);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });
});
