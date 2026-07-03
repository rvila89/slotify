/**
 * TESTS de la GUARDA DE ORIGEN de la transición «resultado de visita — cliente
 * interesado» (`2.v` → `2.b`) (US-009 / UC-08) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-009, spec-delta `consultas` (Requirement "Guarda de origen — el
 * registro del resultado 'interesado' solo es válido desde 2.v"), design.md §D-1 (la
 * guarda se añade a la máquina declarativa como DATO, no como `if` disperso:
 * `ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO = {2v}`, MONO-estado; todo origen
 * distinto —`2a`, `2b`, `2c`, `2d`, terminales `2x/2y/2z` y estados no-consulta— se
 * rechaza). Skill `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de US-008 (origen multi-estado `{2a,2b,2c}`), US-009 es
 * MONO-estado: SOLO `2v`. Una consulta en cola `2.d` nunca tuvo visita programada, así
 * que aquí `2.d` es un origen inválido más (sin mensaje UC-12 dedicado, a diferencia
 * de US-008).
 *
 * RED: aún NO existe `esOrigenValidoParaResultadoVisitaInteresado` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaResultadoVisitaInteresado,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen legal ÚNICO: consulta / 2v (D-1 mono-estado). La transición
//    permitida es exactamente {consulta,2v} → {consulta,2b}.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaInteresado — único origen válido {2v}', () => {
  it('debe_aceptar_consulta_2v_como_unico_origen_valido_de_la_transicion_a_2b', () => {
    expect(esOrigenValidoParaResultadoVisitaInteresado('consulta', '2v')).toBe(true);
  });
});

// ===========================================================================
// 2. El resto de sub-estados ACTIVOS de consulta (2a/2b/2c/2d) NO son origen.
//    A diferencia de US-008, la cola 2.d es un origen inválido más (sin submensaje
//    UC-12): una consulta en cola nunca ha tenido visita programada.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaInteresado — sub-estados activos no-2v rechazados', () => {
  const noValidos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2d'];

  it.each(noValidos)(
    'no_debe_aceptar_consulta_%s_como_origen_de_la_transicion_a_2b',
    (subEstado) => {
      expect(esOrigenValidoParaResultadoVisitaInteresado('consulta', subEstado)).toBe(
        false,
      );
    },
  );
});

// ===========================================================================
// 3. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaInteresado — sub-estados terminales son inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen_de_la_transicion_a_2b',
    (subEstado) => {
      expect(esOrigenValidoParaResultadoVisitaInteresado('consulta', subEstado)).toBe(
        false,
      );
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de `consulta` → origen inválido. Incluye
//    reserva_cancelada / reserva_completada (inmutables, terminales).
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaInteresado — estados no-consulta rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)(
    'no_debe_aceptar_el_estado_%s_como_origen_de_la_transicion_a_2b',
    (estado) => {
      expect(esOrigenValidoParaResultadoVisitaInteresado(estado, null)).toBe(false);
    },
  );
});

// ===========================================================================
// 5. `subEstado = null` en `consulta` (caso defensivo) → no es origen válido.
// ===========================================================================

describe('esOrigenValidoParaResultadoVisitaInteresado — consulta sin sub-estado no es origen', () => {
  it('no_debe_aceptar_consulta_con_sub_estado_null', () => {
    expect(esOrigenValidoParaResultadoVisitaInteresado('consulta', null)).toBe(false);
  });
});
