/**
 * TESTS del DESGLOSE FISCAL congelado y el REPARTO 40/60/fianza — DOMINIO PURO
 * (US-014 / UC-14) — fase TDD RED. tasks.md Fase 3: 3.3 (tarifa congelada +
 * desglose base/IVA/total), y base del reparto que consume 3.5/3.8.
 *
 * Trazabilidad: US-014, spec-delta `presupuestos` (Requirement "Congelado de
 * tarifa y desglose fiscal del PRESUPUESTO al confirmar", escenarios "Confirmar
 * crea el PRESUPUESTO congelado con IVA 21%" y "Un cambio posterior del tarifario
 * no recalcula"), design.md §D-5 (base = total / 1.21; ivaImporte = total - base;
 * iva_porcentaje = 21). Contrato: schema `DesgloseFiscal` (ivaPorcentaje "21.00")
 * y `RepartoPago` (senalEur 40%, liquidacionEur 60%, fianzaEur aparte).
 *
 * FUNCIONES PURAS de dominio (hook `no-infra-in-domain`): no importan `@nestjs/*`,
 * Prisma ni infraestructura. El total ENTRA con IVA incluido (el motor de tarifa
 * de US-016 devuelve `precio_tarifa_eur` con IVA 21% incluido); el desglose sólo
 * DERIVA la base y el IVA a partir de él.
 *
 * RED: aún NO existe `presupuestos/domain/desglose-fiscal.ts` con
 * `calcularDesgloseFiscal` / `calcularReparto`. El import falla y la batería está
 * en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  calcularDesgloseFiscal,
  calcularReparto,
  type DesgloseFiscal,
  type RepartoPago,
} from '../domain/desglose-fiscal';

// 6.2: el cálculo se parametriza por régimen. Estos escenarios congelados de 6.1b son
// CON IVA (comportamiento no regresivo); se pasa el régimen explícito.
const CON_IVA = 'con_iva' as const;

// ===========================================================================
// 3.3 — Desglose fiscal: base = total / 1.21, IVA = total - base, iva% = 21.
//        Los importes se expresan como Decimal string (Importe/Porcentaje del
//        contrato): "21.00", 2 decimales.
// ===========================================================================

describe('calcularDesgloseFiscal — deriva base e IVA de un total con IVA incluido (3.3)', () => {
  it('debe_derivar_base_e_iva_de_un_total_de_1076_con_iva_21', () => {
    // 1076 / 1.21 = 889.26 (base); IVA = 1076 - 889.26 = 186.74.
    const out: DesgloseFiscal = calcularDesgloseFiscal({
      totalConIva: 1076,
      regimen: CON_IVA,
    });

    expect(out.ivaPorcentaje).toBe('21.00');
    expect(out.baseImponible).toBe('889.26');
    expect(out.ivaImporte).toBe('186.74');
    expect(out.total).toBe('1076.00');
  });

  it('debe_cumplir_la_invariante_base_mas_iva_igual_al_total', () => {
    const out = calcularDesgloseFiscal({ totalConIva: 1136, regimen: CON_IVA });

    const base = Number(out.baseImponible);
    const iva = Number(out.ivaImporte);
    const total = Number(out.total);
    // Coherencia contable: base + IVA = total (a 2 decimales).
    expect(Number((base + iva).toFixed(2))).toBe(total);
    expect(out.ivaPorcentaje).toBe('21.00');
  });

  it('debe_restar_el_descuento_del_total_antes_de_derivar_base_e_iva', () => {
    // total bruto 1136, descuento 136 → total neto 1000; base = 1000/1.21 = 826.45.
    const out = calcularDesgloseFiscal({
      totalConIva: 1136,
      descuentoEur: 136,
      regimen: CON_IVA,
    });

    expect(out.total).toBe('1000.00');
    expect(out.baseImponible).toBe('826.45');
    expect(out.ivaImporte).toBe('173.55');
  });

  it('debe_aceptar_un_total_manual_del_caso_tarifa_a_consultar', () => {
    // Precio manual (IVA incluido) del caso >50 invitados: mismo cálculo fiscal.
    const out = calcularDesgloseFiscal({ totalConIva: 2500, regimen: CON_IVA });

    expect(out.total).toBe('2500.00');
    expect(out.ivaPorcentaje).toBe('21.00');
    expect(Number(out.baseImponible) + Number(out.ivaImporte)).toBeCloseTo(2500, 2);
  });
});

// ===========================================================================
// 3.5/3.8 — Reparto informativo 40% señal / 60% liquidación + fianza aparte.
//        pct_senal (40) y fianza_default_eur vienen de TENANT_SETTINGS (nunca
//        hardcodeados en la lógica). La fianza NO forma parte del total.
// ===========================================================================

describe('calcularReparto — 40/60 + fianza derivados de TENANT_SETTINGS', () => {
  it('debe_repartir_1000_en_400_de_senal_y_600_de_liquidacion_con_fianza_aparte', () => {
    const out: RepartoPago = calcularReparto({
      totalConIva: 1000,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });

    expect(out.senalEur).toBe('400.00');
    expect(out.liquidacionEur).toBe('600.00');
    // La fianza es un importe aparte (TENANT_SETTINGS.fianza_default_eur).
    expect(out.fianzaEur).toBe('500.00');
  });

  it('debe_cumplir_que_senal_mas_liquidacion_es_igual_al_total_sin_contar_la_fianza', () => {
    const out = calcularReparto({
      totalConIva: 1076,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });

    const suma = Number(out.senalEur) + Number(out.liquidacionEur);
    expect(Number(suma.toFixed(2))).toBe(1076);
  });

  it('debe_derivar_el_porcentaje_de_senal_del_setting_y_no_de_una_constante_fija', () => {
    // Con pct_senal = 30, la señal es 300 y la liquidación 700 (no 400/600).
    const out = calcularReparto({
      totalConIva: 1000,
      pctSenal: 30,
      fianzaDefaultEur: 500,
      regimen: CON_IVA,
    });

    expect(out.senalEur).toBe('300.00');
    expect(out.liquidacionEur).toBe('700.00');
  });
});
