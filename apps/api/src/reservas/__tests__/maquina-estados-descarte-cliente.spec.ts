/**
 * TESTS del MAPA/GUARDA DECLARATIVOS del DESCARTE POR CLIENTE → 2.z
 * (`resolverDescarteCliente(estado, subEstado)` + `MAPA_DESCARTE_CLIENTE`) de US-013
 * (UC-10, A17, "Marcar consulta como descartada por cliente") — fase TDD RED.
 * tasks.md §"TDD primero (RED)" — máquina de estados.
 *
 * Trazabilidad: US-013 §Historia / §Reglas de negocio / §Reglas de Validación;
 * spec-delta `consultas` (Requirement "Transición de descarte por cliente de sub_estado
 * no terminal a 2.z" y "Guarda de origen — el descarte por cliente solo es válido desde
 * un sub_estado no terminal"); design.md §D-1 (tabla origen→efectos), §D-4 (2z ≠ 2y ≠
 * 2x). CLAUDE.md §Máquina de estados; skill `state-machine`.
 *
 * MAPA_DESCARTE_CLIENTE (origen no terminal → destino terminal 2.z):
 *   { consulta, 2a } → { consulta, 2z }
 *   { consulta, 2b } → { consulta, 2z }
 *   { consulta, 2c } → { consulta, 2z }
 *   { consulta, 2d } → { consulta, 2z }
 *   { consulta, 2v } → { consulta, 2z }
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS, NO
 * `if` dispersos, en paralelo estricto a `MAPA_EXPIRACION_TTL` (US-012) y
 * `MAPA_PROMOCION_COLA` (US-018). El destino de descarte por cliente es SIEMPRE `2z` —
 * NUNCA `2x` (expiración por TTL, US-012) ni `2y` (vaciado de cola al activar
 * pre-reserva, US-014). Los terminales (`2x/2y/2z`/`reserva_cancelada`/
 * `reserva_completada`) y los no-orígenes devuelven `null`: el descarte se rechaza sin
 * efectos (guarda de origen). Al ser pura y re-evaluable, se invoca DENTRO de la
 * transacción bajo el lock (base de RC-1/RC-3).
 *
 * RED: aún NO existen `resolverDescarteCliente` ni `ResultadoDescarteCliente` ni
 * `MAPA_DESCARTE_CLIENTE` en `reservas/domain/maquina-estados.ts`. La batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import {
  resolverDescarteCliente,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoDescarteCliente,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Orígenes NO TERMINALES de CONSULTA (2a/2b/2c/2d/2v) → destino terminal 2z.
//    spec-delta: "{consulta, 2a|2b|2c|2d|2v} → {consulta, 2z}".
// ===========================================================================

describe('resolverDescarteCliente — 2a/2b/2c/2d/2v de consulta descartan a 2z', () => {
  const noTerminales: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2d', '2v'];

  it.each(noTerminales)(
    'debe_resolver_consulta_%s_a_consulta_2z',
    (subEstado) => {
      const destino = resolverDescarteCliente('consulta', subEstado);
      expect(destino).toEqual<ResultadoDescarteCliente>({
        estado: 'consulta',
        subEstado: '2z',
      });
    },
  );
});

// ===========================================================================
// 2. Sub-estados TERMINALES de consulta (2x/2y/2z) → null (guarda de origen: 2z es
//    inmutable; 2x/2y son terminales distintos que tampoco se descartan).
//    spec-delta: "Descarte sobre una RESERVA en estado terminal se rechaza sin efectos".
// ===========================================================================

describe('resolverDescarteCliente — terminales de consulta NO se descartan (null)', () => {
  const terminalesConsulta: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminalesConsulta)(
    'no_debe_descartar_el_sub_estado_terminal_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverDescarteCliente('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 3. Estados PRINCIPALES terminales/no-consulta → null. El descarte por cliente solo
//    aplica a la fase `consulta`; una pre_reserva/reserva_confirmada/… no se descarta
//    por esta vía, y los terminales (reserva_cancelada/reserva_completada) son inmutables.
// ===========================================================================

describe('resolverDescarteCliente — estados principales distintos de consulta NO se descartan (null)', () => {
  const otrosEstados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(otrosEstados)(
    'no_debe_descartar_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverDescarteCliente(estado, null)).toBeNull();
    },
  );

  it('no_debe_descartar_una_consulta_sin_sub_estado_caso_defensivo', () => {
    expect(resolverDescarteCliente('consulta', null)).toBeNull();
  });
});

// ===========================================================================
// 4. Determinismo (LOOKUP en tabla declarativa, no condicionales dispersos) y
//    distinción explícita del terminal 2z frente a 2x (TTL) y 2y (cola).
// ===========================================================================

describe('resolverDescarteCliente — determinismo y distinción de terminales', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverDescarteCliente('consulta', '2b');
    const b = resolverDescarteCliente('consulta', '2b');
    expect(a).toEqual(b);
  });

  it('debe_resolver_siempre_a_2z_y_nunca_a_2x_ni_2y', () => {
    // El destino de descarte por CLIENTE es SIEMPRE 2z (nunca 2x de TTL ni 2y de cola),
    // verificado contra la ficha US-013 §Reglas de negocio y design.md §D-4.
    (['2a', '2b', '2c', '2d', '2v'] as const).forEach((sub) => {
      const destino = resolverDescarteCliente('consulta', sub);
      expect(destino?.subEstado).toBe('2z');
      expect(destino?.subEstado).not.toBe('2x');
      expect(destino?.subEstado).not.toBe('2y');
    });
  });
});
