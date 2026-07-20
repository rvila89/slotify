/**
 * TESTS del MAPA/GUARDA DECLARATIVOS de la TRANSICIÓN de cambio de fecha DESDE LA COLA
 * (`resolverCambioFechaEnCola(estado, subEstado)` + `MAPA_CAMBIAR_FECHA_EN_COLA`) del change
 * `cambiar-fecha-consulta-en-cola` — fase TDD RED. tasks.md §"TDD primero" (máquina de
 * estados: transición `2d → 2b`; orígenes no válidos → 422).
 *
 * Trazabilidad: spec-delta `consultas` (Requirement "Cambio atómico de una fecha ya
 * bloqueada", escenario "Cambiar una consulta en cola (2d) a una fecha libre la saca de la
 * cola y pasa a 2.b"); design.md §D-4 (2d cambia `sub_estado 2d → 2b`). CLAUDE.md §Máquina
 * de estados; skill `state-machine`.
 *
 * MAPA_CAMBIAR_FECHA_EN_COLA (único origen de la rama cola → destino con bloqueo propio):
 *   { consulta, 2d } → { consulta, 2b }
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la transición es ESTRUCTURA DE DATOS, NO `if`
 * dispersos, en paralelo estricto a `MAPA_PROMOCION_COLA` (US-018): la única diferencia con
 * la promoción es el ORIGEN de la mutación (aquí, un cambio de fecha explícito), pero el
 * par (origen → destino) es idéntico `2d → 2b`. Cualquier otro origen devuelve `null`
 * (guarda estricta → 422 en la aplicación).
 *
 * RED: aún NO existen `resolverCambioFechaEnCola` ni `MAPA_CAMBIAR_FECHA_EN_COLA` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (símbolo inexistente). GREEN es de `backend-developer`.
 */
import {
  resolverCambioFechaEnCola,
  MAPA_CAMBIAR_FECHA_EN_COLA,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. La ÚNICA transición de la rama cola: { consulta, 2d } → { consulta, 2b }.
// ===========================================================================

describe('resolverCambioFechaEnCola — 2d cambia a 2b al mover a fecha libre', () => {
  it('debe_resolver_consulta_2d_a_consulta_2b', () => {
    expect(resolverCambioFechaEnCola('consulta', '2d')).toEqual({
      estado: 'consulta',
      subEstado: '2b',
    });
  });

  it('el_mapa_declarativo_contiene_exactamente_2d_a_2b', () => {
    expect(MAPA_CAMBIAR_FECHA_EN_COLA).toEqual([
      { origen: { estado: 'consulta', subEstado: '2d' }, destino: { estado: 'consulta', subEstado: '2b' } },
    ]);
  });
});

// ===========================================================================
// 2. Orígenes NO válidos → `null` (guarda estricta; la aplicación mapea a 422).
// ===========================================================================

describe('resolverCambioFechaEnCola — orígenes no válidos devuelven null (→ 422)', () => {
  it.each(['2a', '2b', '2c', '2v', '2x', '2y', '2z'] as const)(
    'debe_devolver_null_para_consulta_%s',
    (sub: SubEstadoConsulta) => {
      expect(resolverCambioFechaEnCola('consulta', sub)).toBeNull();
    },
  );

  it('debe_devolver_null_para_subEstado_null', () => {
    expect(resolverCambioFechaEnCola('consulta', null)).toBeNull();
  });

  it.each([
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
  ] as const)('debe_devolver_null_para_el_estado_no_consulta_%s', (estado) => {
    expect(resolverCambioFechaEnCola(estado as EstadoReserva, '2d')).toBeNull();
  });
});
