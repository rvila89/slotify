/**
 * TESTS de la GUARDA DE ORIGEN de la transición «añadir fecha» (US-005 / UC-04)
 * — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-005, spec-delta `consultas` (Requirement "Guarda de origen — la
 * transición solo es válida desde sub_estado 2.a"), design.md §D-3 (la guarda se
 * añade a la máquina declarativa: solo `{consulta,2a} → {consulta,2b}` y
 * `{consulta,2a} → {consulta,2d}` son transiciones permitidas; el resto se rechaza
 * con error de validación, modelado como DATO, no como `if` disperso),
 * CLAUDE.md §Máquina de estados.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de US-004 (entradas INICIALES del agregado), aquí se valida
 * el ORIGEN de una transición sobre un agregado que YA existe: solo `consulta/2a`
 * puede recibir una fecha; `2b/2c/2d/2v`, los terminales `2x/2y/2z` y los estados
 * `reserva_cancelada`/`reserva_completada` (inmutables) NO.
 *
 * RED: aún NO existe `esOrigenValidoParaAnadirFecha` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaAnadirFecha,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Único origen legal de la transición: consulta / 2a.
// ===========================================================================

describe('esOrigenValidoParaAnadirFecha — único origen válido es consulta/2a', () => {
  it('debe_aceptar_consulta_2a_como_origen_valido_de_la_transicion', () => {
    expect(esOrigenValidoParaAnadirFecha('consulta', '2a')).toBe(true);
  });
});

// ===========================================================================
// 2. Sub-estados de consulta NO exploratorios → origen inválido (sin efectos).
// ===========================================================================

describe('esOrigenValidoParaAnadirFecha — otros sub-estados de consulta rechazados', () => {
  const noValidos: ReadonlyArray<SubEstadoConsulta> = ['2b', '2c', '2d', '2v'];

  it.each(noValidos)(
    'no_debe_aceptar_consulta_%s_como_origen_de_la_transicion',
    (subEstado) => {
      expect(esOrigenValidoParaAnadirFecha('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaAnadirFecha — sub-estados terminales son inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen',
    (subEstado) => {
      expect(esOrigenValidoParaAnadirFecha('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de `consulta` → origen inválido.
//    pre_reserva / reserva_confirmada / reserva_cancelada / reserva_completada.
// ===========================================================================

describe('esOrigenValidoParaAnadirFecha — estados no-consulta rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_aceptar_el_estado_%s_como_origen', (estado) => {
    expect(esOrigenValidoParaAnadirFecha(estado, null)).toBe(false);
  });
});
