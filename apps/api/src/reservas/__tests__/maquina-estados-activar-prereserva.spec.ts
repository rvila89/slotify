/**
 * TESTS de la GUARDA DE ORIGEN de la transición «activar pre_reserva» (US-014 /
 * UC-14) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: US-014, spec-delta `consultas` (Requirement "Transición
 * {2a,2b,2c,2v} → pre_reserva al confirmar el presupuesto") y spec-delta
 * `presupuestos` (Requirement "Precondición — origen válido…"); design.md §D-2
 * (la guarda se añade a la máquina declarativa como DATO —
 * `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA = {2a,2b,2c,2v}`— no como `if`
 * disperso); CLAUDE.md §Máquina de estados.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una
 * ESTRUCTURA DE DATOS. A diferencia de US-005 (origen estricto `2a`) y US-007
 * (origen estricto `2b`), esta transición admite CUATRO orígenes de consulta
 * ACTIVA (`2a/2b/2c/2v`): exploratoria, con fecha bloqueada, pendiente de
 * invitados y visita programada. La cola `2d`, los terminales (`2x/2y/2z`),
 * `pre_reserva`/posteriores y `reserva_cancelada`/`reserva_completada` (inmutables)
 * NO son orígenes legales. Mismo patrón que `esOrigenValidoParaProgramarVisita`.
 *
 * RED: aún NO existe `esOrigenValidoParaActivarPrereserva` en
 * `reservas/domain/maquina-estados.ts`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esOrigenValidoParaActivarPrereserva,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Orígenes legales de la transición: consulta / {2a, 2b, 2c, 2v}.
// ===========================================================================

describe('esOrigenValidoParaActivarPrereserva — orígenes válidos {2a,2b,2c,2v}', () => {
  const validos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2v'];

  it.each(validos)(
    'debe_aceptar_consulta_%s_como_origen_valido_de_activar_pre_reserva',
    (subEstado) => {
      expect(esOrigenValidoParaActivarPrereserva('consulta', subEstado)).toBe(true);
    },
  );
});

// ===========================================================================
// 2. Cola 2.d → NO es origen legal (debe promoverse primero; se rechaza 409).
// ===========================================================================

describe('esOrigenValidoParaActivarPrereserva — la cola 2d no es origen', () => {
  it('no_debe_aceptar_consulta_2d_como_origen', () => {
    expect(esOrigenValidoParaActivarPrereserva('consulta', '2d')).toBe(false);
  });
});

// ===========================================================================
// 3. Sub-estados terminales de consulta (2x/2y/2z) → inmutables, origen inválido.
// ===========================================================================

describe('esOrigenValidoParaActivarPrereserva — sub-estados terminales inmutables', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_aceptar_el_sub_estado_terminal_%s_como_origen',
    (subEstado) => {
      expect(esOrigenValidoParaActivarPrereserva('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de `consulta` → origen inválido. Incluye
//    `pre_reserva` (ya confirmada: no se vuelve a activar).
// ===========================================================================

describe('esOrigenValidoParaActivarPrereserva — estados no-consulta rechazados', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_aceptar_el_estado_%s_como_origen', (estado) => {
    expect(esOrigenValidoParaActivarPrereserva(estado, null)).toBe(false);
  });
});
