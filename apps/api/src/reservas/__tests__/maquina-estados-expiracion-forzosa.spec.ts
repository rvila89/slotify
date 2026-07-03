/**
 * TESTS del MAPA/GUARDA DECLARATIVOS de EXPIRACIÓN FORZOSA de la bloqueante viva por
 * la promoción MANUAL del Gestor (`resolverExpiracionForzosaBloqueante(estado,
 * subEstado)` + `MAPA_EXPIRACION_FORZOSA_BLOQUEANTE`) de US-019 (UC-12 FA manual) —
 * fase TDD RED. tasks.md Fase 3: 3.1 (guarda de expiración forzosa `2b/2c/2v → 2x`).
 *
 * Trazabilidad: US-019, spec-delta `consultas` (Requirement "Expiración forzosa de la
 * bloqueante activa antes de la promoción manual": la bloqueante viva `sub_estado ∈
 * {2b,2c,2v}` con TTL vigente O ya vencido pero aún no barrido pasa a `2x`,
 * `ttl_expiracion → NULL`, reutilizando la semántica terminal `2.x` de US-012 pero
 * aplicada DELIBERADAMENTE por el Gestor); design.md §D-2 (guarda de la bloqueante a
 * expirar, modelada declarativamente reutilizando la tabla de expiración de US-012),
 * §D-3 (orden dentro de la transacción). CLAUDE.md §Máquina de estados; skill
 * `state-machine`.
 *
 * MAPA_EXPIRACION_FORZOSA_BLOQUEANTE (origen bloqueante viva → destino terminal 2x):
 *   { consulta, 2b } → { consulta, 2x }
 *   { consulta, 2c } → { consulta, 2x }
 *   { consulta, 2v } → { consulta, 2x }
 *
 * DIFERENCIA CLAVE con `MAPA_EXPIRACION_TTL` (US-012): la expiración forzosa NO aplica a
 * `pre_reserva` (una bloqueante de cola siempre es una consulta con fecha `2b/2c/2v`);
 * el destino de `pre_reserva` en US-012 es `reserva_cancelada`, que NO es un origen
 * válido de la promoción manual de cola. La guarda es una ESTRUCTURA DE DATOS, no `if`
 * dispersos, y se re-evalúa DENTRO de la transacción bajo el lock (base de RC-A/RC-B).
 *
 * RED: aún NO existen `resolverExpiracionForzosaBloqueante`,
 * `MAPA_EXPIRACION_FORZOSA_BLOQUEANTE` ni `ResultadoExpiracionForzosa` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (símbolo inexistente). GREEN es de `backend-developer`.
 */
import {
  resolverExpiracionForzosaBloqueante,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoExpiracionForzosa,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Orígenes de bloqueante VIVA (2b/2c/2v) → 2x. La bloqueante que posee la fecha
//    (consulta con fecha, pendiente de invitados o visita programada) se expira
//    forzosamente al ser reemplazada por la promovida.
//    spec-delta: "R1 pasa a sub_estado = '2x', ttl_expiracion → NULL".
// ===========================================================================

describe('resolverExpiracionForzosaBloqueante — bloqueante viva 2b/2c/2v se expira a 2x', () => {
  const vivas: ReadonlyArray<SubEstadoConsulta> = ['2b', '2c', '2v'];

  it.each(vivas)('debe_expirar_la_bloqueante_%s_a_consulta_2x', (subEstado) => {
    const destino = resolverExpiracionForzosaBloqueante('consulta', subEstado);
    expect(destino).toEqual<ResultadoExpiracionForzosa>({
      estado: 'consulta',
      subEstado: '2x',
    });
  });
});

// ===========================================================================
// 2. La cola (2d), la exploratoria (2a) y los terminales (2x/2y/2z) NO son
//    bloqueantes vivas: no se expiran (null). Nadie fuera de {2b,2c,2v} bloquea la
//    fecha, así que no hay bloqueante que reemplazar desde ellos.
// ===========================================================================

describe('resolverExpiracionForzosaBloqueante — sub-estados no bloqueantes NO se expiran (null)', () => {
  const noBloqueantes: ReadonlyArray<SubEstadoConsulta> = ['2a', '2d', '2x', '2y', '2z'];

  it.each(noBloqueantes)(
    'no_debe_expirar_el_sub_estado_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverExpiracionForzosaBloqueante('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 3. A diferencia de la expiración por TTL de US-012, `pre_reserva` NO es una
//    bloqueante de cola (una fecha con cola siempre la bloquea una consulta 2b/2c/2v):
//    la expiración forzosa de la promoción manual NO aplica a pre_reserva ni a ningún
//    otro estado principal distinto de consulta → null.
// ===========================================================================

describe('resolverExpiracionForzosaBloqueante — estados no-consulta NO se expiran (null)', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_expirar_el_estado_%s_devolviendo_null', (estado) => {
    expect(resolverExpiracionForzosaBloqueante(estado, null)).toBeNull();
  });

  it('no_debe_expirar_una_consulta_sin_sub_estado_caso_defensivo', () => {
    expect(resolverExpiracionForzosaBloqueante('consulta', null)).toBeNull();
  });
});

// ===========================================================================
// 4. La resolución es un LOOKUP en tabla declarativa (función pura, determinista):
//    misma entrada → mismo destino; el único destino de expiración forzosa es 2x
//    (terminal, NUNCA 2y descarte por cola ni 2z descarte por cliente).
// ===========================================================================

describe('resolverExpiracionForzosaBloqueante — determinismo (función pura sobre tabla de datos)', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverExpiracionForzosaBloqueante('consulta', '2b');
    const b = resolverExpiracionForzosaBloqueante('consulta', '2b');
    expect(a).toEqual(b);
  });

  it('el_unico_destino_de_expiracion_forzosa_es_2x_nunca_2y_ni_2z', () => {
    for (const sub of ['2b', '2c', '2v'] as const) {
      expect(resolverExpiracionForzosaBloqueante('consulta', sub)?.subEstado).toBe('2x');
    }
  });
});
