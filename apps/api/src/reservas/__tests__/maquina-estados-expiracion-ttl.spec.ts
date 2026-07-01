/**
 * TESTS del MAPA/GUARDA DECLARATIVOS de expiración por TTL
 * (`resolverExpiracionTtl(estado, subEstado)` + `MAPA_EXPIRACION_TTL`) de US-012
 * (UC-09, "Expirar consulta automáticamente por TTL agotado") — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-012, spec-delta `consultas` (Requirement "Guarda de origen
 * declarativa — solo estados candidatos expiran; los terminales son inmutables";
 * escenario "El mapa declarativo resuelve el estado terminal de cada origen" y
 * "Una RESERVA en estado terminal no se expira aunque su TTL esté vencido"),
 * design.md §D-3 (transición terminal modelada como TABLA DE DATOS en
 * `maquina-estados.ts`, NO `if` dispersos; una función pura consulta el mapa y
 * devuelve el destino o `null` si no es candidato). CLAUDE.md §Máquina de estados;
 * skill `state-machine`.
 *
 * MAPA_EXPIRACION_TTL (origen candidato → destino terminal):
 *   { consulta, 2b }      → { consulta, 2x }
 *   { consulta, 2c }      → { consulta, 2x }
 *   { consulta, 2v }      → { consulta, 2x }
 *   { pre_reserva, null } → { reserva_cancelada, null }
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS.
 * `2y`/`2z` (descartes de US-007/US-013) NO son destinos de expiración por TTL; los
 * terminales y cualquier otro estado activo devuelven `null` (no se expira aunque el
 * TTL esté vencido). La guarda se evalúa DENTRO de la transacción de cada RESERVA
 * (base de la idempotencia y de RC-1), por eso es pura y re-evaluable.
 *
 * RED: aún NO existen `resolverExpiracionTtl` ni `ResultadoExpiracionTtl` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (símbolo inexistente). GREEN es de `backend-developer`.
 */
import {
  resolverExpiracionTtl,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoExpiracionTtl,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Orígenes candidatos de CONSULTA (2b/2c/2v) → destino terminal 2x.
//    spec-delta: "devuelve 2x para 2b/2c/2v".
// ===========================================================================

describe('resolverExpiracionTtl — 2b/2c/2v de consulta expiran a 2x', () => {
  const candidatos: ReadonlyArray<SubEstadoConsulta> = ['2b', '2c', '2v'];

  it.each(candidatos)(
    'debe_resolver_consulta_%s_a_consulta_2x',
    (subEstado) => {
      const destino = resolverExpiracionTtl('consulta', subEstado);
      expect(destino).toEqual<ResultadoExpiracionTtl>({
        estado: 'consulta',
        subEstado: '2x',
      });
    },
  );
});

// ===========================================================================
// 2. `pre_reserva` (sin sub-estado) → `reserva_cancelada` con sub_estado NULL.
//    spec-delta: "reserva_cancelada (sub_estado NULL) para pre_reserva".
// ===========================================================================

describe('resolverExpiracionTtl — pre_reserva expira a reserva_cancelada', () => {
  it('debe_resolver_pre_reserva_a_reserva_cancelada_con_sub_estado_null', () => {
    const destino = resolverExpiracionTtl('pre_reserva', null);
    expect(destino).toEqual<ResultadoExpiracionTtl>({
      estado: 'reserva_cancelada',
      subEstado: null,
    });
  });
});

// ===========================================================================
// 3. Terminales INMUTABLES (2x/2y/2z/reserva_cancelada/reserva_completada) → null.
//    spec-delta: "Una RESERVA en estado terminal no se expira aunque su TTL esté
//    vencido" — la guarda de origen la excluye devolviendo `null`.
// ===========================================================================

describe('resolverExpiracionTtl — terminales de consulta NO expiran (null)', () => {
  const terminalesConsulta: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminalesConsulta)(
    'no_debe_expirar_el_sub_estado_terminal_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverExpiracionTtl('consulta', subEstado)).toBeNull();
    },
  );

  it('no_debe_expirar_una_reserva_ya_cancelada_devolviendo_null', () => {
    expect(resolverExpiracionTtl('reserva_cancelada', null)).toBeNull();
  });

  it('no_debe_expirar_una_reserva_completada_devolviendo_null', () => {
    expect(resolverExpiracionTtl('reserva_completada', null)).toBeNull();
  });
});

// ===========================================================================
// 4. No-candidatos: sub-estados de consulta 2a (sin fecha) y 2d (cola) → null.
//    2.a no tiene bloqueo que liberar; 2.d es cola, no la consulta bloqueante.
// ===========================================================================

describe('resolverExpiracionTtl — 2a y 2d de consulta NO son candidatos (null)', () => {
  const noCandidatos: ReadonlyArray<SubEstadoConsulta> = ['2a', '2d'];

  it.each(noCandidatos)(
    'no_debe_expirar_el_sub_estado_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverExpiracionTtl('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 5. Estados principales activos (no candidatos) → null. Solo `pre_reserva` expira
//    a nivel de estado principal; `reserva_confirmada`/`evento_en_curso`/
//    `post_evento` NO expiran por TTL (su ciclo lo gobiernan otras US).
// ===========================================================================

describe('resolverExpiracionTtl — estados principales no candidatos NO expiran (null)', () => {
  const noCandidatos: ReadonlyArray<EstadoReserva> = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
  ];

  it.each(noCandidatos)(
    'no_debe_expirar_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverExpiracionTtl(estado, null)).toBeNull();
    },
  );

  it('no_debe_expirar_una_consulta_sin_sub_estado_caso_defensivo', () => {
    expect(resolverExpiracionTtl('consulta', null)).toBeNull();
  });
});

// ===========================================================================
// 6. La resolución es un LOOKUP en tabla declarativa, no condicionales dispersos:
//    misma entrada → mismo destino (función pura, sin efectos ni estado).
// ===========================================================================

describe('resolverExpiracionTtl — determinismo (función pura sobre tabla de datos)', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverExpiracionTtl('consulta', '2b');
    const b = resolverExpiracionTtl('consulta', '2b');
    expect(a).toEqual(b);
  });

  it('no_debe_confundir_el_terminal_de_ttl_2x_con_los_descartes_2y_ni_2z', () => {
    // El destino de expiración por TTL es SIEMPRE 2x (nunca 2y de cola ni 2z de
    // cliente), verificado contra la ficha US-012 §Reglas de negocio.
    expect(resolverExpiracionTtl('consulta', '2b')?.subEstado).toBe('2x');
    expect(resolverExpiracionTtl('consulta', '2c')?.subEstado).toBe('2x');
    expect(resolverExpiracionTtl('consulta', '2v')?.subEstado).toBe('2x');
  });
});
