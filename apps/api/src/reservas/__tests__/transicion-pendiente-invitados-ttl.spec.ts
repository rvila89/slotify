/**
 * TESTS de DOMINIO PURO de la EXTENSIÓN del TTL de la transición a `2.c`
 * (US-007 / UC-06) — fase TDD RED. tasks.md Fase 3: 3.2 (parte TTL).
 *
 * Trazabilidad: US-007, spec-delta `consultas` (Requirements "Transición 2.b → 2.c …
 * extiende el bloqueo" y "La extensión del TTL se deriva de TENANT_SETTINGS, no
 * hardcodeada"), design.md §D-4 (reusar `resolverPlanBloqueo({ fase: '2.c' })` →
 * `extend`; nuevo TTL = `ttl_actual + ttl_consulta_dias`, **base = ttl actual**, NO
 * `now()`; el incremento se deriva del setting, nunca hardcodeado).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): se ejercita la función pura
 * `resolverPlanBloqueo` (ya existente, fase `2.c` → `extend`) y la primitiva pura
 * `extenderTtl(base, deltaDias)` que calcula el TTL absoluto SOBRE EL TTL ACTUAL de
 * la RESERVA (no sobre `now()`), una sola fuente de verdad reutilizada por el
 * use-case y el adaptador (UPDATE de RESERVA + FECHA_BLOQUEADA).
 *
 * RED: `resolverPlanBloqueo({fase:'2.c'})` ya devuelve `extend`+`ttlDeltaDias` (US-040),
 * pero `extenderTtl` AÚN NO EXISTE en `domain/bloquear-fecha.service.ts`. El import
 * falla en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import {
  resolverPlanBloqueo,
  extenderTtl,
  type TenantSettingsBloqueo,
} from '../domain/bloquear-fecha.service';

const AHORA = new Date('2026-06-28T10:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

const settings = (over: Partial<TenantSettingsBloqueo> = {}): TenantSettingsBloqueo => ({
  ttlConsultaDias: 5,
  ttlPrereservaDias: 7,
  ...over,
});

// ===========================================================================
// 1. resolverPlanBloqueo({fase:'2.c'}) → extend + delta derivado del setting.
//    El TTL absoluto NO se conoce en dominio (depende del valor persistido): se
//    transporta el incremento `ttlDeltaDias = ttl_consulta_dias`.
// ===========================================================================

describe('resolverPlanBloqueo — fase 2.c extiende (no hardcodea) con delta = ttl_consulta_dias', () => {
  it('debe_devolver_modo_extend_tipo_blando_y_delta_derivado_del_setting_5_dias', () => {
    const plan = resolverPlanBloqueo({ fase: '2.c', ahora: AHORA, settings: settings() });

    expect(plan.modo).toBe('extend');
    expect(plan.tipo).toBe('blando');
    // El delta sale del setting (ttl_consulta_dias=5), nunca un literal del código.
    expect(plan.ttlDeltaDias).toBe(5);
    // En `extend` el TTL absoluto NO se resuelve en dominio (depende del persistido).
    expect(plan.ttl).toBeNull();
  });

  it('debe_seguir_el_setting_cuando_ttl_consulta_dias_cambia_a_otro_valor', () => {
    const plan = resolverPlanBloqueo({
      fase: '2.c',
      ahora: AHORA,
      settings: settings({ ttlConsultaDias: 10 }),
    });

    expect(plan.ttlDeltaDias).toBe(10);
  });
});

// ===========================================================================
// 2. extenderTtl(base, delta): el nuevo TTL se calcula SOBRE EL TTL ACTUAL de la
//    RESERVA (base), NO sobre `now()`. Una consulta con bloqueo que aún no expira
//    SUMA los días al vencimiento vigente (regla §D-4).
// ===========================================================================

describe('extenderTtl — base = ttl actual de la RESERVA (no now())', () => {
  it('debe_sumar_ttl_consulta_dias_al_ttl_actual_no_a_now', () => {
    const ttlActual = new Date('2026-07-01T10:00:00.000Z'); // > now(), aún vigente
    const nuevo = extenderTtl(ttlActual, 5);

    // base = ttlActual (1 de julio), +5 días → 6 de julio (NO now()+5 = 3 de julio).
    expect(nuevo.getTime()).toBe(ttlActual.getTime() + 5 * DIA_MS);
    expect(nuevo.getTime()).not.toBe(AHORA.getTime() + 5 * DIA_MS);
  });

  it('debe_ser_funcion_pura_sin_mutar_la_fecha_base', () => {
    const ttlActual = new Date('2026-07-01T10:00:00.000Z');
    const copia = new Date(ttlActual.getTime());

    extenderTtl(ttlActual, 5);

    expect(ttlActual.getTime()).toBe(copia.getTime());
  });
});
