/**
 * TESTS de la GUARDA DE ORIGEN de la transición «descartar pre-reserva»
 * (`pre_reserva → reserva_cancelada`, workstream B del change
 * `presupuesto-prereserva-cta-descarte-y-e2`) — fase TDD RED.
 *
 * Trazabilidad: design.md §"Workstream B" (guarda declarativa
 * `ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado: null }]`,
 * "calcada de `ORIGENES_TRANSICION_CONFIRMAR_SENAL` (US-021)"; el destino terminal reutiliza
 * `MAPA_EXPIRACION_TTL` `{pre_reserva}→{reserva_cancelada}`); spec-delta `consultas`
 * (Requirement "Descarte manual de una pre-reserva a estado terminal por el Gestor":
 * "La transición es mono-origen: el ÚNICO origen legal es `pre_reserva` (sub_estado `NULL`)…
 * Cualquier otro estado que NO sea `pre_reserva` … NO es origen legal → 422").
 * CLAUDE.md §Máquina de estados; skill `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA DE DATOS
 * declarativa, NO con `if` dispersos. A diferencia de US-013 (descarte de CONSULTA, multi
 * sub-estado `{2a,2b,2c,2d,2v}` → 2z), esta transición es MONO-estado desde el estado PRINCIPAL
 * `pre_reserva` (sub_estado NULL) → `reserva_cancelada`. Mismo patrón EXACTO que
 * `esOrigenValidoParaConfirmarSenal` (US-021). Todo sub-estado de `consulta`
 * (`2a/2b/2c/2d/2v/2x/2y/2z`), el propio destino y posteriores, y `reserva_cancelada`
 * (inmutable) NO son orígenes legales.
 *
 * RED: aún NO existen `esOrigenValidoParaDescartarPreReserva` ni
 * `ORIGENES_TRANSICION_DESCARTAR_PRERESERVA` en `reservas/domain/maquina-estados.ts`. El import
 * falla en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  esOrigenValidoParaDescartarPreReserva,
  ORIGENES_TRANSICION_DESCARTAR_PRERESERVA,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen legal ÚNICO de la transición: `pre_reserva` (sub_estado NULL).
// ===========================================================================

describe('esOrigenValidoParaDescartarPreReserva — origen válido pre_reserva', () => {
  it('debe_aceptar_pre_reserva_como_unico_origen_valido_de_descartar_prereserva', () => {
    expect(esOrigenValidoParaDescartarPreReserva('pre_reserva', null)).toBe(true);
  });

  it('debe_declarar_pre_reserva_como_unica_entrada_de_la_tabla_declarativa', () => {
    // La tabla es la única fuente de verdad (no `if` dispersos): mono-origen estricto.
    expect(ORIGENES_TRANSICION_DESCARTAR_PRERESERVA).toEqual([
      { estado: 'pre_reserva', subEstado: null },
    ]);
  });
});

// ===========================================================================
// 2. Sub-estados de consulta (activos y terminales 2a…2z) → origen inválido: una
//    consulta se descarta por la vía de US-013 (→2z), NO por esta transición.
// ===========================================================================

describe('esOrigenValidoParaDescartarPreReserva — sub-estados de consulta rechazados', () => {
  const subEstados: ReadonlyArray<SubEstadoConsulta> = [
    '2a',
    '2b',
    '2c',
    '2d',
    '2v',
    '2x',
    '2y',
    '2z',
  ];

  it.each(subEstados)(
    'no_debe_aceptar_consulta_%s_como_origen_de_descartar_prereserva',
    (subEstado) => {
      expect(esOrigenValidoParaDescartarPreReserva('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Estados principales distintos de `pre_reserva` → origen inválido. Incluye
//    `reserva_confirmada` y posteriores (ya avanzada la reserva) y los terminales
//    `reserva_completada`/`reserva_cancelada` (inmutables).
// ===========================================================================

describe('esOrigenValidoParaDescartarPreReserva — estados no-pre_reserva rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_aceptar_el_estado_%s_como_origen', (estado) => {
    expect(esOrigenValidoParaDescartarPreReserva(estado, null)).toBe(false);
  });
});

// ===========================================================================
// 4. Determinismo (LOOKUP en tabla declarativa) y defensa: un `pre_reserva` con un
//    sub-estado espurio (dato inconsistente) NO es origen legal (solo sub_estado NULL).
// ===========================================================================

describe('esOrigenValidoParaDescartarPreReserva — determinismo y defensa', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = esOrigenValidoParaDescartarPreReserva('pre_reserva', null);
    const b = esOrigenValidoParaDescartarPreReserva('pre_reserva', null);
    expect(a).toBe(b);
  });

  it('no_debe_aceptar_pre_reserva_con_sub_estado_espurio', () => {
    expect(esOrigenValidoParaDescartarPreReserva('pre_reserva', '2b')).toBe(false);
  });
});
