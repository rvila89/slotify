/**
 * TESTS del DESGLOSE FISCAL de la factura de señal — DOMINIO PURO
 * (US-022 / UC-18) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-022, spec-delta `facturacion` (Requirement "Desglose fiscal de la
 * factura con IVA 21 % y redondeo contable", escenario "1.200 € de total desglosa
 * 991,74 base + 208,26 IVA"); design.md §D-2 (base = round(total/1,21, 2);
 * iva = total − base; iva_porcentaje = 21,00; redondeo contable half-up).
 * Contrato: schema `FacturaSenalDto` (baseImponible, ivaPorcentaje "21.00", ivaImporte,
 * total como Importe/Porcentaje string de 2 decimales).
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa `@nestjs/*`, Prisma ni
 * infraestructura. El `total` ENTRA congelado (= RESERVA.importe_senal, US-021); el
 * desglose sólo DERIVA la base y el IVA a partir de él, SIN recalcular el porcentaje de
 * señal ni la tarifa. El `iva_importe` se obtiene POR RESTA del total (no por segundo
 * round de la base) para que `base + iva = total` sea EXACTO, sin descuadre de céntimos.
 *
 * RED: aún NO existe `facturacion/domain/calculo-factura.ts` con
 * `calcularDesgloseFacturaSenal`. El import falla y la batería está en ROJO por AUSENCIA
 * DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  calcularDesgloseFacturaSenal,
  type DesgloseFacturaSenal,
} from '../domain/calculo-factura';

// ===========================================================================
// 3.1 — Desglose fiscal: base = round(total / 1,21, 2); iva = total − base;
//        iva_porcentaje = 21,00. Importes como Decimal string (2 decimales).
// ===========================================================================

describe('calcularDesgloseFacturaSenal — deriva base e IVA del total congelado (3.1)', () => {
  it('debe_desglosar_1200_de_total_en_991_74_de_base_y_208_26_de_iva', () => {
    // Ejemplo del AC: total = 1.200,00 → base = round(1200/1,21, 2) = 991,74;
    //                 iva = 1200 − 991,74 = 208,26.
    const out: DesgloseFacturaSenal = calcularDesgloseFacturaSenal({ total: '1200.00' });

    expect(out.ivaPorcentaje).toBe('21.00');
    expect(out.baseImponible).toBe('991.74');
    expect(out.ivaImporte).toBe('208.26');
    expect(out.total).toBe('1200.00');
  });

  it('debe_desglosar_100_de_total_en_82_64_de_base_y_17_36_de_iva', () => {
    // Segundo ejemplo: total = 100,00 → base = round(100/1,21, 2) = 82,64;
    //                  iva = 100 − 82,64 = 17,36.
    const out = calcularDesgloseFacturaSenal({ total: '100.00' });

    expect(out.ivaPorcentaje).toBe('21.00');
    expect(out.baseImponible).toBe('82.64');
    expect(out.ivaImporte).toBe('17.36');
    expect(out.total).toBe('100.00');
  });

  it('debe_fijar_el_iva_porcentaje_al_21_por_ciento_del_mvp', () => {
    const out = calcularDesgloseFacturaSenal({ total: '500.00' });

    expect(out.ivaPorcentaje).toBe('21.00');
  });
});

// ===========================================================================
// 3.1 — Invariante contable: base + iva = total EXACTO en TODOS los importes,
//        gracias a derivar el iva por resta (no por doble redondeo).
// ===========================================================================

describe('calcularDesgloseFacturaSenal — invariante base + iva = total exacto (3.1)', () => {
  const totales: ReadonlyArray<string> = [
    '1200.00',
    '100.00',
    '333.33',
    '0.01',
    '999999.99',
    '250.55',
    '1000.00',
    '400.00',
  ];

  it.each(totales)('debe_cumplir_base_mas_iva_igual_al_total_para_%s', (total) => {
    const out = calcularDesgloseFacturaSenal({ total });

    const base = Number(out.baseImponible);
    const iva = Number(out.ivaImporte);
    // Coherencia contable EXACTA a 2 decimales: base + iva = total.
    expect(Number((base + iva).toFixed(2))).toBe(Number(out.total));
    // Y el total del desglose es el total de entrada, sin alterarlo.
    expect(out.total).toBe(Number(total).toFixed(2));
  });

  it('debe_derivar_el_iva_por_resta_y_no_por_segundo_round_de_la_base', () => {
    // Con un total que provocaría descuadre si el IVA se calculara como
    // round(base × 0,21): la resta garantiza base + iva = total sin desajuste.
    const out = calcularDesgloseFacturaSenal({ total: '250.55' });

    const base = Number(out.baseImponible);
    const iva = Number(out.ivaImporte);
    expect(Number((base + iva).toFixed(2))).toBe(250.55);
  });
});

// ===========================================================================
// 3.1 — La factura NO recalcula el porcentaje de la señal ni la tarifa: el
//        `total` es el `importe_senal` ya congelado en US-021 y se respeta.
// ===========================================================================

describe('calcularDesgloseFacturaSenal — no recalcula el porcentaje de señal', () => {
  it('debe_respetar_el_total_congelado_como_total_del_desglose', () => {
    // importe_senal congelado con pct_senal = 50 en US-021 → total = 1.000,00.
    const out = calcularDesgloseFacturaSenal({ total: '1000.00' });

    // El desglose NO toca el total (no aplica ningún porcentaje de señal).
    expect(out.total).toBe('1000.00');
    expect(out.baseImponible).toBe('826.45');
    expect(out.ivaImporte).toBe('173.55');
  });
});
