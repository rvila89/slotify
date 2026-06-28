/**
 * TESTS de la FUNCIÓN DECLARATIVA de sub-estado del alta CON FECHA
 * (US-004 / UC-03) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-004, spec-delta `consultas` (Requirement "Determinación
 * declarativa del sub-estado de alta según el estado de la fecha"), design.md
 * §D-3 (tabla declarativa `REGLAS_ALTA_CON_FECHA` + `determinarAltaConFecha`),
 * CLAUDE.md §Máquina de estados ("Las transiciones permitidas y sus guardas se
 * modelan como estructura de datos, no como código disperso").
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la decisión 2.b/2.d/2.a se resuelve
 * con una ESTRUCTURA DE DATOS (no `if/else` disperso), a partir del ESTADO DE LA
 * FECHA visto por el alta:
 *   - libre                              → { subEstado: '2b', accion: 'bloquear' }
 *   - bloqueada-por-2b                   → { subEstado: '2d', accion: 'encolar' }
 *   - bloqueada-por-2c|2v|pre|conf+      → { subEstado: '2a', accion: 'exploratoria' }
 *
 * Esta MISMA función la reutiliza la re-derivación de la concurrencia D4 (D-6):
 * tras un P2002 en el INSERT de 2.b, al reabrir la transacción la fecha ya está
 * "bloqueada-por-2b" → la tabla devuelve 2.d. Una sola fuente de verdad.
 *
 * RED: aún NO existen `determinarAltaConFecha`/`EstadoFecha`/`ResultadoAlta`/
 * `AccionAlta` en `reservas/domain/maquina-estados.ts`, ni las entradas iniciales
 * `consulta/2b` y `consulta/2d`. Los imports fallan y la batería está en ROJO.
 * GREEN es responsabilidad de `backend-developer`.
 */
import {
  determinarAltaConFecha,
  esEntradaInicialValida,
  type EstadoFecha,
  type ResultadoAlta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Fecha libre → 2.b / bloquear
// ===========================================================================

describe('determinarAltaConFecha — fecha libre (2.b / bloquear)', () => {
  it('debe_resolver_2b_y_bloquear_cuando_la_fecha_esta_libre', () => {
    const estado: EstadoFecha = { tipo: 'libre' };

    const resultado: ResultadoAlta = determinarAltaConFecha(estado);

    expect(resultado.subEstado).toBe('2b');
    expect(resultado.accion).toBe('bloquear');
  });
});

// ===========================================================================
// 2. Fecha bloqueada por una consulta en 2.b → 2.d / encolar
// ===========================================================================

describe('determinarAltaConFecha — bloqueada por 2.b (2.d / encolar)', () => {
  it('debe_resolver_2d_y_encolar_cuando_la_fecha_esta_bloqueada_por_una_consulta_2b', () => {
    const estado: EstadoFecha = {
      tipo: 'bloqueada',
      subEstadoBloqueante: '2b',
      estadoBloqueante: 'consulta',
    };

    const resultado = determinarAltaConFecha(estado);

    expect(resultado.subEstado).toBe('2d');
    expect(resultado.accion).toBe('encolar');
  });
});

// ===========================================================================
// 3. Fecha bloqueada por estados NO encolables → 2.a / exploratoria
//    2.c, 2.v, pre_reserva, reserva_confirmada (y posteriores) → exploratoria.
// ===========================================================================

describe('determinarAltaConFecha — bloqueada por estado superior (2.a / exploratoria)', () => {
  it('debe_resolver_2a_exploratoria_cuando_la_fecha_esta_bloqueada_por_2c', () => {
    const estado: EstadoFecha = {
      tipo: 'bloqueada',
      subEstadoBloqueante: '2c',
      estadoBloqueante: 'consulta',
    };

    const resultado = determinarAltaConFecha(estado);

    expect(resultado.subEstado).toBe('2a');
    expect(resultado.accion).toBe('exploratoria');
  });

  it('debe_resolver_2a_exploratoria_cuando_la_fecha_esta_bloqueada_por_2v_visita', () => {
    const estado: EstadoFecha = {
      tipo: 'bloqueada',
      subEstadoBloqueante: '2v',
      estadoBloqueante: 'consulta',
    };

    expect(determinarAltaConFecha(estado)).toEqual({
      subEstado: '2a',
      accion: 'exploratoria',
    });
  });

  it('debe_resolver_2a_exploratoria_cuando_la_fecha_esta_bloqueada_por_pre_reserva', () => {
    const estado: EstadoFecha = {
      tipo: 'bloqueada',
      subEstadoBloqueante: null,
      estadoBloqueante: 'pre_reserva',
    };

    expect(determinarAltaConFecha(estado)).toEqual({
      subEstado: '2a',
      accion: 'exploratoria',
    });
  });

  it('debe_resolver_2a_exploratoria_cuando_la_fecha_esta_bloqueada_por_reserva_confirmada', () => {
    const estado: EstadoFecha = {
      tipo: 'bloqueada',
      subEstadoBloqueante: null,
      estadoBloqueante: 'reserva_confirmada',
    };

    expect(determinarAltaConFecha(estado)).toEqual({
      subEstado: '2a',
      accion: 'exploratoria',
    });
  });
});

// ===========================================================================
// 4. Entradas iniciales del agregado ampliadas con 2.b y 2.d (D-3)
//    `esEntradaInicialValida` debe aceptar consulta/2b y consulta/2d además de 2a.
// ===========================================================================

describe('Máquina de estados — entradas iniciales 2.b y 2.d (alta con fecha)', () => {
  it('debe_aceptar_consulta_2b_como_entrada_inicial_valida', () => {
    expect(esEntradaInicialValida('consulta', '2b')).toBe(true);
  });

  it('debe_aceptar_consulta_2d_como_entrada_inicial_valida', () => {
    expect(esEntradaInicialValida('consulta', '2d')).toBe(true);
  });

  it('no_debe_aceptar_un_sub_estado_terminal_como_entrada_inicial', () => {
    expect(esEntradaInicialValida('consulta', '2x')).toBe(false);
  });
});
