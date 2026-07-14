/**
 * TESTS del CÁLCULO FISCAL POR RÉGIMEN — DOMINIO PURO (épico #6, rebanada 6.2
 * `documentos-presupuesto-sin-iva-doble-numeracion`) — fase TDD RED.
 * tasks.md Fase 3: 3.1b.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirement "Total, IVA y reparto del
 * presupuesto dependientes del régimen"; escenarios "CON IVA — el total suma el 21% a la
 * base", "SIN IVA — el total es la base, sin IVA (importe menor)", "El reparto 40/60 se
 * calcula sobre el total del régimen", "La derivación fiscal es una función de dominio
 * pura por régimen"); design.md §"Impacto en el cálculo fiscal por régimen" (base MISMA
 * en ambos; CON IVA = base+IVA21; SIN IVA = base, IVA 0 = importe MENOR; reparto 40/60
 * sobre el total del régimen; fiança fija igual).
 *
 * DECISIÓN CRÍTICA DEL GATE (2026-07-14): el cliente en efectivo paga MENOS (sin el 21%).
 * La 6.2 SÍ toca el cálculo fiscal: `calcularDesgloseFiscal` y `calcularReparto` pasan a
 * recibir el `RegimenIva` como entrada y ramifican de forma DECLARATIVA (sin `if`
 * dispersos por la capa de aplicación).
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`presupuestos/domain/
 * desglose-fiscal.ts`, extendido):
 *   - `CalcularDesgloseFiscalInput` gana `regimen: RegimenIva`.
 *   - `CalcularRepartoInput` gana `regimen: RegimenIva`; el campo del total se mantiene
 *     `totalConIva` (nombre congelado de 6.1b: es "el total de entrada con IVA incluido",
 *     del que el desglose deriva la base; el reparto SIEMPRE opera sobre el `total` del
 *     régimen ya resuelto, que la capa de aplicación pasa como este campo).
 *   - El enum `RegimenIva` se importa de `../domain/regimen-desde-metodo-pago`.
 *
 * FUNCIONES PURAS de dominio (hook `no-infra-in-domain`): no importan `@nestjs/*`,
 * Prisma ni infraestructura. El total ENTRA con IVA 21% incluido; la base = total/1.21 es
 * la MISMA en ambos regímenes; lo que cambia es si se le suma el IVA.
 *
 * RED: `calcularDesgloseFiscal`/`calcularReparto` aún NO aceptan `regimen`, y el enum
 * `RegimenIva` aún NO existe en `regimen-desde-metodo-pago`. La batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  calcularDesgloseFiscal,
  calcularReparto,
  type DesgloseFiscal,
  type RepartoPago,
} from '../domain/desglose-fiscal';
import type { RegimenIva } from '../domain/regimen-desde-metodo-pago';

const CON_IVA: RegimenIva = 'con_iva';
const SIN_IVA: RegimenIva = 'sin_iva';

// ===========================================================================
// 3.1b — CON IVA: base 1000 → total 1210 (IVA 210). El total de entrada llega
//         con IVA incluido: 1210 → base 1000, IVA 210 (comportamiento 6.1b).
// ===========================================================================

describe('calcularDesgloseFiscal — CON IVA suma el 21% a la base (3.1b)', () => {
  it('debe_derivar_base_1000_iva_210_total_1210_de_un_total_con_iva_de_1210', () => {
    // Arrange — total de entrada con IVA incluido 1210 (= base 1000 + 21%).
    // Act
    const out: DesgloseFiscal = calcularDesgloseFiscal({
      totalConIva: 1210,
      regimen: CON_IVA,
    });

    // Assert — base 1000, IVA 210, total 1210, iva% 21.
    expect(out.baseImponible).toBe('1000.00');
    expect(out.ivaPorcentaje).toBe('21.00');
    expect(out.ivaImporte).toBe('210.00');
    expect(out.total).toBe('1210.00');
  });

  it('debe_cumplir_la_invariante_base_mas_iva_igual_total_en_con_iva', () => {
    const out = calcularDesgloseFiscal({ totalConIva: 1210, regimen: CON_IVA });

    const base = Number(out.baseImponible);
    const iva = Number(out.ivaImporte);
    const total = Number(out.total);
    expect(Number((base + iva).toFixed(2))).toBe(total);
  });
});

// ===========================================================================
// 3.1b — SIN IVA: base 1000 → total 1000 (IVA 0). El importe es MENOR que CON
//         IVA (1000 < 1210). La base es la MISMA; NO se le suma el 21%.
// ===========================================================================

describe('calcularDesgloseFiscal — SIN IVA: total = base, IVA 0 (importe menor) (3.1b)', () => {
  it('debe_derivar_base_1000_iva_0_total_1000_de_un_total_con_iva_de_1210', () => {
    // El total de entrada llega igual (1210, con IVA incluido); la base derivada es la
    // MISMA (1000) que en CON IVA, pero SIN IVA el total del presupuesto es la base.
    const out: DesgloseFiscal = calcularDesgloseFiscal({
      totalConIva: 1210,
      regimen: SIN_IVA,
    });

    expect(out.baseImponible).toBe('1000.00');
    expect(out.ivaPorcentaje).toBe('0.00');
    expect(out.ivaImporte).toBe('0.00');
    expect(out.total).toBe('1000.00');
  });

  it('debe_cumplir_la_invariante_total_igual_base_y_iva_cero_en_sin_iva', () => {
    const out = calcularDesgloseFiscal({ totalConIva: 1210, regimen: SIN_IVA });

    expect(out.total).toBe(out.baseImponible);
    expect(Number(out.ivaImporte)).toBe(0);
    expect(Number(out.ivaPorcentaje)).toBe(0);
  });

  it('debe_producir_un_total_MENOR_en_sin_iva_que_en_con_iva_para_la_misma_entrada', () => {
    // Mismo total de entrada (1210) y misma base derivada (1000): SIN IVA cobra 1000,
    // CON IVA cobra 1210. El régimen SIN IVA es el importe MENOR.
    const conIva = calcularDesgloseFiscal({ totalConIva: 1210, regimen: CON_IVA });
    const sinIva = calcularDesgloseFiscal({ totalConIva: 1210, regimen: SIN_IVA });

    // Misma base imponible en ambos regímenes.
    expect(sinIva.baseImponible).toBe(conIva.baseImponible);
    // Pero el total SIN IVA (1000) es menor que el CON IVA (1210).
    expect(Number(sinIva.total)).toBeLessThan(Number(conIva.total));
    expect(Number(sinIva.total)).toBe(1000);
    expect(Number(conIva.total)).toBe(1210);
  });
});

// ===========================================================================
// 3.1b — El descuento se resta del total de entrada ANTES de derivar la base,
//         igual en ambos regímenes (orden descuento→base→régimen).
// ===========================================================================

describe('calcularDesgloseFiscal — descuento antes de la base, en ambos regímenes (3.1b)', () => {
  it('con_iva_debe_restar_el_descuento_del_total_de_entrada_antes_de_derivar_base', () => {
    // total bruto 1210, descuento 210 → total neto 1000; base = 1000/1.21 = 826.45.
    const out = calcularDesgloseFiscal({
      totalConIva: 1210,
      descuentoEur: 210,
      regimen: CON_IVA,
    });

    expect(out.total).toBe('1000.00');
    expect(out.baseImponible).toBe('826.45');
    expect(out.ivaImporte).toBe('173.55');
  });

  it('sin_iva_debe_derivar_la_misma_base_pero_cobrarla_como_total_sin_iva', () => {
    // Misma entrada y descuento: base 826.45; SIN IVA el total es la base (826.45).
    const out = calcularDesgloseFiscal({
      totalConIva: 1210,
      descuentoEur: 210,
      regimen: SIN_IVA,
    });

    expect(out.baseImponible).toBe('826.45');
    expect(out.total).toBe('826.45');
    expect(out.ivaImporte).toBe('0.00');
    expect(out.ivaPorcentaje).toBe('0.00');
  });
});

// ===========================================================================
// 3.1b — Reparto 40/60 sobre el TOTAL DEL RÉGIMEN + fiança fija igual en ambos.
//         El reparto opera sobre el `total` ya resuelto del régimen (la capa de
//         aplicación pasa el total del régimen como `totalConIva`).
// ===========================================================================

describe('calcularReparto — 40/60 sobre el total del régimen + fiança fija (3.1b)', () => {
  it('con_iva_debe_repartir_1210_en_484_de_senal_y_726_de_liquidacion', () => {
    // 40% de 1210 = 484.00; 60% = 726.00.
    const out: RepartoPago = calcularReparto({
      totalConIva: 1210,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });

    expect(out.senalEur).toBe('484.00');
    expect(out.liquidacionEur).toBe('726.00');
    expect(out.fianzaEur).toBe('500.00');
  });

  it('sin_iva_debe_repartir_1000_en_400_de_senal_y_600_de_liquidacion_sobre_el_total_sin_iva', () => {
    // El total SIN IVA es 1000 (= base): 40% = 400.00; 60% = 600.00.
    const out: RepartoPago = calcularReparto({
      totalConIva: 1000,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: SIN_IVA,
    });

    expect(out.senalEur).toBe('400.00');
    expect(out.liquidacionEur).toBe('600.00');
    // La fiança es fija (setting), aparte del total, IGUAL que en CON IVA.
    expect(out.fianzaEur).toBe('500.00');
  });

  it('la_fianza_es_identica_en_ambos_regimenes_para_el_mismo_setting', () => {
    const conIva = calcularReparto({
      totalConIva: 1210,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });
    const sinIva = calcularReparto({
      totalConIva: 1000,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: SIN_IVA,
    });

    // Misma fiança fija del setting, con independencia del régimen.
    expect(sinIva.fianzaEur).toBe(conIva.fianzaEur);
    expect(sinIva.fianzaEur).toBe('500.00');
  });

  it('debe_cumplir_que_senal_mas_liquidacion_es_el_total_del_regimen_sin_contar_la_fianza', () => {
    const sinIva = calcularReparto({
      totalConIva: 1000,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: SIN_IVA,
    });

    const suma = Number(sinIva.senalEur) + Number(sinIva.liquidacionEur);
    expect(Number(suma.toFixed(2))).toBe(1000);
  });
});

// ===========================================================================
// 3.1b — NO REGRESIÓN del cálculo CON IVA de 6.1b: los ejemplos congelados de
//         `desglose-fiscal.spec.ts` (6.1b) deben seguir dando el mismo resultado
//         cuando se pasa el régimen `con_iva`.
// ===========================================================================

describe('calcularDesgloseFiscal/calcularReparto — NO regresión CON IVA de 6.1b (3.1b)', () => {
  it('debe_derivar_889_26_y_186_74_de_1076_con_iva_igual_que_en_6_1b', () => {
    // Ejemplo congelado de 6.1b: 1076/1.21 = 889.26; IVA = 186.74.
    const out = calcularDesgloseFiscal({ totalConIva: 1076, regimen: CON_IVA });

    expect(out.ivaPorcentaje).toBe('21.00');
    expect(out.baseImponible).toBe('889.26');
    expect(out.ivaImporte).toBe('186.74');
    expect(out.total).toBe('1076.00');
  });

  it('debe_repartir_1076_en_430_40_y_645_60_con_iva_igual_que_en_el_use_case_de_6_1b', () => {
    // Reparto 40/60 del total con IVA 1076 (coherente con generar-presupuesto 6.1b).
    const out = calcularReparto({
      totalConIva: 1076,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });

    expect(out.senalEur).toBe('430.40');
    expect(out.liquidacionEur).toBe('645.60');
    expect(out.fianzaEur).toBe('500.00');
  });
});
