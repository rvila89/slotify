/**
 * TESTS de la GUARDA/MAPA declarativos del CIERRE AUTOMÁTICO A10 en T-1d
 * (US-026 / UC-20 FA-01, actor Sistema) — DOMINIO PURO — fase TDD RED.
 * tasks.md Fase 3: 3.1 (mapa/guarda declarativos del cierre A10).
 *
 * Trazabilidad: US-026; spec-delta `ficha-operativa` (Requirement "Cierre automático
 * de la ficha en T-1d con los datos disponibles (A10)"); design.md §D-3 (transición
 * de cierre como ESTRUCTURA DE DATOS declarativa, consistente con la máquina de
 * estados de US-025): `pendiente → cerrado`, `en_curso → cerrado`, `cerrado → (no
 * candidato: idempotente, no-op)`. CLAUDE.md §Máquina de estados (transiciones y
 * guardas como estructura de datos, NO `if` dispersos); skill `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): este spec NO importa `@nestjs/*`, Prisma
 * ni infraestructura; ejercita solo una función pura sobre la estructura de datos de
 * la máquina de estados de `pre_evento_status` (reusa el tipo `PreEventoStatus` de
 * la máquina existente de US-025).
 *
 * RED: aún NO existe `resolverCierreAutomatico` en
 * `ficha-evento/domain/maquina-estados-pre-evento.ts`. El import falla en compilación
 * y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  resolverCierreAutomatico,
  type PreEventoStatus,
} from '../maquina-estados-pre-evento';

// ===========================================================================
// 3.1 — El cierre automático A10 lleva a `cerrado` desde los DOS estados abiertos:
//        `pendiente` (ficha nunca tocada) y `en_curso` (ficha parcialmente rellena).
//        `resolverCierreAutomatico(origen)` devuelve el destino `'cerrado'` cuando la
//        RESERVA es candidata; `null` cuando NO lo es (idempotencia).
// ===========================================================================

describe('resolverCierreAutomatico — estados abiertos transicionan a cerrado', () => {
  it('debe_resolver_cerrado_desde_pendiente', () => {
    expect(resolverCierreAutomatico('pendiente')).toBe('cerrado');
  });

  it('debe_resolver_cerrado_desde_en_curso', () => {
    expect(resolverCierreAutomatico('en_curso')).toBe('cerrado');
  });
});

// ===========================================================================
// 3.1 — `cerrado` es ESTABLE e IDEMPOTENTE: una ficha ya cerrada NO es candidata del
//        cierre automático → `resolverCierreAutomatico('cerrado') = null` (no-op). Es
//        la base declarativa de la idempotencia del barrido (D-3/D-4): la guarda se
//        re-evalúa dentro de la transacción de cada RESERVA.
// ===========================================================================

describe('resolverCierreAutomatico — cerrado no es candidato (idempotente, no-op)', () => {
  it('debe_resolver_null_cuando_ya_esta_cerrado', () => {
    expect(resolverCierreAutomatico('cerrado')).toBeNull();
  });
});

// ===========================================================================
// 3.1 — Determinismo (lookup en tabla de datos, no `if` dispersos): misma entrada →
//        mismo resultado; cobertura exhaustiva de los tres estados posibles.
// ===========================================================================

describe('resolverCierreAutomatico — mapa declarativo determinista', () => {
  const casos: ReadonlyArray<[PreEventoStatus, PreEventoStatus | null]> = [
    ['pendiente', 'cerrado'],
    ['en_curso', 'cerrado'],
    ['cerrado', null],
  ];

  it.each(casos)('debe_mapear_%s_a_%s', (origen, destino) => {
    expect(resolverCierreAutomatico(origen)).toBe(destino);
  });

  it('debe_ser_determinista_para_la_misma_entrada', () => {
    expect(resolverCierreAutomatico('pendiente')).toBe(resolverCierreAutomatico('pendiente'));
  });
});
