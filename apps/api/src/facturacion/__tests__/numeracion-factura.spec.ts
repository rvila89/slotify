/**
 * TESTS de la NUMERACIÓN `F-YYYY-NNNN` de la factura de señal — DOMINIO PURO
 * (US-022 / UC-18) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: US-022, spec-delta `facturacion` (Requirement "Numeración secuencial
 * única por tenant y año (F-YYYY-NNNN)", escenarios "La primera factura de señal del
 * tenant en el año recibe F-YYYY-0001" y "La numeración es independiente entre tenants
 * distintos"); design.md §D-3 (NNNN = MAX(NNNN)+1 entre las facturas del tenant cuyo
 * numero_factura empieza por `F-{año}-`, padding a 4 dígitos; el año va embebido en el
 * literal, la unicidad `(tenant_id, numero_factura)` cubre "único por tenant + año").
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): calcula el SIGUIENTE número a
 * partir del año de emisión y el ÚLTIMO número existente del tenant en ese año (que le
 * llega ya resuelto; la consulta `MAX` a BD y el reintento ante P2002 son de la capa de
 * aplicación/infra, cubiertos en los tests del use-case y de concurrencia). No importa
 * `@nestjs/*` ni Prisma.
 *
 * RED: aún NO existe `facturacion/domain/numeracion-factura.ts` con
 * `siguienteNumeroFactura`. El import falla y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { siguienteNumeroFactura } from '../domain/numeracion-factura';

// ===========================================================================
// 3.2 — Primera factura del tenant en el año: F-YYYY-0001 (sin previa → null).
// ===========================================================================

describe('siguienteNumeroFactura — primera factura del año (3.2)', () => {
  it('debe_asignar_F_2026_0001_cuando_no_hay_ninguna_factura_previa_del_tenant_en_el_ano', () => {
    const numero = siguienteNumeroFactura({ anio: 2026, ultimoNumero: null });

    expect(numero).toBe('F-2026-0001');
  });

  it('debe_rellenar_la_secuencia_a_4_digitos_con_ceros_a_la_izquierda', () => {
    const numero = siguienteNumeroFactura({ anio: 2026, ultimoNumero: null });

    // Formato F-YYYY-NNNN con NNNN de 4 dígitos.
    expect(numero).toMatch(/^F-2026-\d{4}$/);
    expect(numero).toBe('F-2026-0001');
  });
});

// ===========================================================================
// 3.2 — Secuencia incremental por tenant+año: el segundo número es el siguiente.
// ===========================================================================

describe('siguienteNumeroFactura — secuencia incremental (3.2)', () => {
  it('debe_asignar_F_2026_0002_cuando_el_ultimo_del_ano_es_F_2026_0001', () => {
    const numero = siguienteNumeroFactura({ anio: 2026, ultimoNumero: 'F-2026-0001' });

    expect(numero).toBe('F-2026-0002');
  });

  it('debe_incrementar_correctamente_saltando_a_5_digitos_de_padding_solo_si_hace_falta', () => {
    // El padding es a MÍNIMO 4 dígitos; a partir de 9999 crece el número natural.
    const numero = siguienteNumeroFactura({ anio: 2026, ultimoNumero: 'F-2026-9999' });

    expect(numero).toBe('F-2026-10000');
  });

  it.each([
    ['F-2026-0009', 'F-2026-0010'],
    ['F-2026-0099', 'F-2026-0100'],
    ['F-2026-0123', 'F-2026-0124'],
  ])('debe_calcular_el_siguiente_de_%s_como_%s', (ultimo, esperado) => {
    expect(siguienteNumeroFactura({ anio: 2026, ultimoNumero: ultimo })).toBe(esperado);
  });
});

// ===========================================================================
// 3.2 — Cambio de año: la secuencia se REINICIA a 0001 en el año nuevo.
// ===========================================================================

describe('siguienteNumeroFactura — reinicio por año (3.2)', () => {
  it('debe_reiniciar_a_F_2027_0001_en_el_ano_nuevo_aunque_2026_tuviera_facturas', () => {
    // En 2027 no hay ninguna factura todavía (ultimoNumero del año 2027 = null),
    // aunque en 2026 existiera F-2026-0042.
    const numero = siguienteNumeroFactura({ anio: 2027, ultimoNumero: null });

    expect(numero).toBe('F-2027-0001');
  });

  it('debe_usar_el_ano_de_emision_en_el_literal_del_numero', () => {
    const n2026 = siguienteNumeroFactura({ anio: 2026, ultimoNumero: null });
    const n2027 = siguienteNumeroFactura({ anio: 2027, ultimoNumero: null });

    expect(n2026).toBe('F-2026-0001');
    expect(n2027).toBe('F-2027-0001');
  });
});

// ===========================================================================
// 3.2 — Independencia entre tenants: la función solo depende del último número
//        del PROPIO tenant en el año; dos tenants sin facturas dan F-YYYY-0001.
// ===========================================================================

describe('siguienteNumeroFactura — numeración independiente por tenant (3.2)', () => {
  it('debe_dar_F_2026_0001_a_dos_tenants_distintos_sin_facturas_previas_ese_ano', () => {
    // La independencia la garantiza la unicidad (tenant_id, numero_factura): el
    // cálculo del siguiente número solo mira el último número del propio tenant.
    const tenantA = siguienteNumeroFactura({ anio: 2026, ultimoNumero: null });
    const tenantB = siguienteNumeroFactura({ anio: 2026, ultimoNumero: null });

    expect(tenantA).toBe('F-2026-0001');
    expect(tenantB).toBe('F-2026-0001');
  });
});
