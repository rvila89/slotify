/**
 * TESTS de la GUARDA DE ORIGEN de la transición «resultado de visita — reserva
 * inmediata» (`2.v` → `pre_reserva`) (US-010 / UC-08 FA-08) — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-010, spec-delta `consultas` (Requirement "Guarda de origen — el
 * registro del resultado 'reserva inmediata' solo es válido desde 2.v"), design.md §D-1
 * (la guarda se añade a la máquina declarativa como DATO, no como `if` disperso:
 * `ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA = {2v}`, MONO-estado; todo
 * origen distinto —`2a`, `2b`, `2c`, `2d`, terminales `2x/2y/2z` y estados no-consulta,
 * incluido el propio destino `pre_reserva` (idempotencia)— se rechaza). Skill
 * `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de US-014 (origen multi-estado `{2a,2b,2c,2v}` de la activación
 * de pre_reserva por confirmación de presupuesto), US-010 es un RESULTADO DE VISITA y por
 * tanto MONO-estado: SOLO `2v` (una consulta sin visita programada no puede "registrar el
 * resultado de una visita"). Mismo patrón exacto que
 * `ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO` de US-009.
 *
 * RED: aún NO existe `esOrigenValidoParaResultadoVisitaReservaInmediata` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaResultadoVisitaReservaInmediata,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen legal ÚNICO: consulta / 2v (D-1 mono-estado). La transición permitida
//    es exactamente {consulta,2v} → {pre_reserva, NULL}.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaReservaInmediata — único origen válido {2v}', () => {
  it('debe_aceptar_consulta_2v_como_unico_origen_valido_de_la_transicion_a_pre_reserva', () => {
    expect(
      esOrigenValidoParaResultadoVisitaReservaInmediata('consulta', '2v'),
    ).toBe(true);
  });
});

// ===========================================================================
// 2. El resto de sub-estados ACTIVOS de consulta (2a/2b/2c/2d) NO son origen.
//    A diferencia de US-014 (activar pre_reserva desde {2a,2b,2c,2v}), este resultado
//    de visita SOLO parte de 2v; la cola 2.d es un origen inválido más (una consulta en
//    cola nunca tuvo visita programada).
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaReservaInmediata — sub-estados activos no-2v rechazados', () => {
  const noValidos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2d'];

  it.each(noValidos)(
    'no_debe_aceptar_consulta_%s_como_origen_de_la_transicion_a_pre_reserva',
    (subEstado) => {
      expect(
        esOrigenValidoParaResultadoVisitaReservaInmediata('consulta', subEstado),
      ).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaReservaInmediata — sub-estados terminales son inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen_de_la_transicion_a_pre_reserva',
    (subEstado) => {
      expect(
        esOrigenValidoParaResultadoVisitaReservaInmediata('consulta', subEstado),
      ).toBe(false);
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de `consulta` → origen inválido. Incluye el propio
//    destino `pre_reserva` (idempotencia: ya avanzada) y los terminales
//    reserva_cancelada / reserva_completada (inmutables).
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaReservaInmediata — estados no-consulta (y destino) rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)(
    'no_debe_aceptar_el_estado_%s_como_origen_de_la_transicion_a_pre_reserva',
    (estado) => {
      expect(
        esOrigenValidoParaResultadoVisitaReservaInmediata(estado, null),
      ).toBe(false);
    },
  );
});

// ===========================================================================
// 5. `subEstado = null` en `consulta` (caso defensivo) → no es origen válido.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaReservaInmediata — consulta sin sub-estado no es origen', () => {
  it('no_debe_aceptar_consulta_con_sub_estado_null', () => {
    expect(
      esOrigenValidoParaResultadoVisitaReservaInmediata('consulta', null),
    ).toBe(false);
  });
});
