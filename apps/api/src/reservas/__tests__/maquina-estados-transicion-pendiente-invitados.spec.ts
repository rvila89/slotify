/**
 * TESTS de la GUARDA DE ORIGEN de la transición «marcar como pendiente de
 * invitados» (`2.b → 2.c`) (US-007 / UC-06) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-007, spec-delta `consultas` (Requirement "Guarda de origen — la
 * transición a 2.c solo es válida desde sub_estado 2.b"), design.md §D-3 (la guarda
 * se añade a la máquina declarativa como DATO, no como `if` disperso: solo
 * `{consulta,2b} → {consulta,2c}` es transición permitida; el resto se rechaza).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. Origen ESTRICTO `2.b` (D-1 aprobado): NO se admite `2.a` como origen
 * ("2.a con bloqueo" ≡ 2.b en el modelo). Cualquier otro sub-estado de consulta
 * (`2a/2c/2d/2v`), los terminales (`2x/2y/2z`) y los estados distintos de `consulta`
 * (incluidos `reserva_cancelada`/`reserva_completada`, inmutables) NO son orígenes.
 *
 * RED: aún NO existe `esOrigenValidoParaPendienteInvitados` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaPendienteInvitados,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Único origen legal de la transición a 2.c: consulta / 2b (D-1 estricto).
// ===========================================================================

describe('esOrigenValidoParaPendienteInvitados — único origen válido es consulta/2b', () => {
  it('debe_aceptar_consulta_2b_como_origen_valido_de_la_transicion_a_2c', () => {
    expect(esOrigenValidoParaPendienteInvitados('consulta', '2b')).toBe(true);
  });
});

// ===========================================================================
// 2. D-1 estricto: 2.a NO es origen (no se admite "2.a con bloqueo" como atajo).
// ===========================================================================

describe('esOrigenValidoParaPendienteInvitados — 2.a NO es origen (D-1 estricto)', () => {
  it('no_debe_aceptar_consulta_2a_como_origen_de_la_transicion_a_2c', () => {
    expect(esOrigenValidoParaPendienteInvitados('consulta', '2a')).toBe(false);
  });
});

// ===========================================================================
// 3. Otros sub-estados de consulta NO `2b` → origen inválido (sin efectos).
//    Incluye el propio destino `2c` (no se re-transiciona) y la cola `2d`/visita `2v`.
// ===========================================================================

describe('esOrigenValidoParaPendienteInvitados — otros sub-estados de consulta rechazados', () => {
  const noValidos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2c', '2d', '2v'];

  it.each(noValidos)(
    'no_debe_aceptar_consulta_%s_como_origen_de_la_transicion_a_2c',
    (subEstado) => {
      expect(esOrigenValidoParaPendienteInvitados('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 4. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaPendienteInvitados — sub-estados terminales son inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen_de_la_transicion_a_2c',
    (subEstado) => {
      expect(esOrigenValidoParaPendienteInvitados('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 5. Estados principales distintos de `consulta` → origen inválido.
//    Incluye reserva_cancelada / reserva_completada (inmutables, terminales).
// ===========================================================================

describe('esOrigenValidoParaPendienteInvitados — estados no-consulta rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)(
    'no_debe_aceptar_el_estado_%s_como_origen_de_la_transicion_a_2c',
    (estado) => {
      expect(esOrigenValidoParaPendienteInvitados(estado, null)).toBe(false);
    },
  );
});
