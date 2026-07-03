/**
 * TESTS de la GUARDA DE ORIGEN de la transición «confirmar pago de señal»
 * (`pre_reserva → reserva_confirmada`, US-021 / UC-17) — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-021, spec-delta `consultas` (Requirement "Transición
 * pre_reserva → reserva_confirmada al confirmar el pago de la señal",
 * escenario "Guarda de origen — confirmar sobre una reserva no en pre_reserva
 * se rechaza sin efectos"); design.md §D-8; CLAUDE.md §Máquina de estados.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una
 * ESTRUCTURA DE DATOS declarativa (skill `state-machine`), NO con `if`
 * dispersos. A diferencia de US-014 (activar pre_reserva, origen multi-estado
 * `{2a,2b,2c,2v}` de `consulta`), esta transición es MONO-estado y desde un
 * estado PRINCIPAL: SOLO `pre_reserva` (sub_estado NULL) es origen válido; su
 * destino único es `reserva_confirmada`. Cualquier sub-estado de `consulta`
 * (`2a/2b/2c/2d/2v/2x/2y/2z`), el propio destino `reserva_confirmada` y
 * posteriores (`evento_en_curso`/`post_evento`/`reserva_completada`) y
 * `reserva_cancelada` (inmutable) NO son orígenes legales. Mismo patrón que
 * `esOrigenValidoParaActivarPrereserva`.
 *
 * RED: aún NO existe `esOrigenValidoParaConfirmarSenal` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  esOrigenValidoParaConfirmarSenal,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen legal ÚNICO de la transición: `pre_reserva` (sub_estado NULL).
// ===========================================================================

describe('esOrigenValidoParaConfirmarSenal — origen válido pre_reserva', () => {
  it('debe_aceptar_pre_reserva_como_unico_origen_valido_de_confirmar_senal', () => {
    expect(esOrigenValidoParaConfirmarSenal('pre_reserva', null)).toBe(true);
  });
});

// ===========================================================================
// 2. Sub-estados de consulta (activos y terminales) → origen inválido: una
//    consulta nunca puede confirmar el pago de la señal (aún no es pre_reserva).
// ===========================================================================

describe('esOrigenValidoParaConfirmarSenal — sub-estados de consulta rechazados', () => {
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
    'no_debe_aceptar_consulta_%s_como_origen_de_confirmar_senal',
    (subEstado) => {
      expect(esOrigenValidoParaConfirmarSenal('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Estados principales distintos de `pre_reserva` → origen inválido. Incluye
//    `reserva_confirmada` (ya confirmada: no se vuelve a confirmar) y
//    `reserva_cancelada` (inmutable).
// ===========================================================================

describe('esOrigenValidoParaConfirmarSenal — estados no-pre_reserva rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_aceptar_el_estado_%s_como_origen', (estado) => {
    expect(esOrigenValidoParaConfirmarSenal(estado, null)).toBe(false);
  });
});
