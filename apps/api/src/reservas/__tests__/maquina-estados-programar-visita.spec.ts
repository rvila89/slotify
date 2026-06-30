/**
 * TESTS de la GUARDA DE ORIGEN de la transición «programar visita al espacio»
 * (`2.a`/`2.b`/`2.c` → `2.v`) (US-008 / UC-07) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-008, spec-delta `consultas` (Requirement "Guarda de origen — la
 * transición a 2.v solo es válida desde 2.a, 2.b o 2.c"), design.md §D-1 (la guarda
 * se añade a la máquina declarativa como DATO, no como `if` disperso:
 * `ORIGENES_TRANSICION_PROGRAMAR_VISITA = {2a,2b,2c}`; todo origen distinto —`2.d`
 * cola, `2.v`, terminales `2x/2y/2z` y estados no-consulta— se rechaza).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de US-005 (origen estricto `2.a`) y US-007 (origen estricto
 * `2.b`), US-008 admite TRES orígenes de consulta activa (`2a/2b/2c`). La cola `2.d`
 * NO es origen (debe promoverse primero, UC-12); `2.v` (ya programada) tampoco.
 *
 * RED: aún NO existe `esOrigenValidoParaProgramarVisita` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaProgramarVisita,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Orígenes legales: consulta / {2a, 2b, 2c} (D-1 multi-estado).
// ===========================================================================

describe('esOrigenValidoParaProgramarVisita — orígenes válidos {2a,2b,2c}', () => {
  const validos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c'];

  it.each(validos)(
    'debe_aceptar_consulta_%s_como_origen_valido_de_la_transicion_a_2v',
    (subEstado) => {
      expect(esOrigenValidoParaProgramarVisita('consulta', subEstado)).toBe(true);
    },
  );
});

// ===========================================================================
// 2. La cola `2.d` NO es origen: debe promoverse primero (UC-12, FA-01).
//    Tampoco lo es el propio destino `2.v` (no se re-programa una visita aquí).
// ===========================================================================

describe('esOrigenValidoParaProgramarVisita — cola 2d y destino 2v rechazados', () => {
  const noValidos: ReadonlyArray<SubEstadoConsulta> = ['2d', '2v'];

  it.each(noValidos)(
    'no_debe_aceptar_consulta_%s_como_origen_de_la_transicion_a_2v',
    (subEstado) => {
      expect(esOrigenValidoParaProgramarVisita('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaProgramarVisita — sub-estados terminales son inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen_de_la_transicion_a_2v',
    (subEstado) => {
      expect(esOrigenValidoParaProgramarVisita('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de `consulta` → origen inválido.
//    Incluye reserva_cancelada / reserva_completada (inmutables, terminales).
// ===========================================================================

describe('esOrigenValidoParaProgramarVisita — estados no-consulta rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)(
    'no_debe_aceptar_el_estado_%s_como_origen_de_la_transicion_a_2v',
    (estado) => {
      expect(esOrigenValidoParaProgramarVisita(estado, null)).toBe(false);
    },
  );
});

// ===========================================================================
// 5. `subEstado = null` en `consulta` (caso defensivo) → no es origen válido.
// ===========================================================================

describe('esOrigenValidoParaProgramarVisita — consulta sin sub-estado no es origen', () => {
  it('no_debe_aceptar_consulta_con_sub_estado_null', () => {
    expect(esOrigenValidoParaProgramarVisita('consulta', null)).toBe(false);
  });
});
