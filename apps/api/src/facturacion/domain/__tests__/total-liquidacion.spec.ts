/**
 * TESTS del CÁLCULO DEL TOTAL DE LA LIQUIDACIÓN — DOMINIO PURO
 * (US-027 / UC-21, UC-22) — fase TDD RED. tasks.md Fase 3: 3.1 y 3.2.
 *
 * Trazabilidad: US-027, spec-delta `facturacion` (Requirement "Generación automática de la
 * factura de liquidación…", escenarios "Liquidación con extras pendientes suma el 60 % y los
 * extras con factura_id nulo" y "Liquidación sin extras pendientes es solo el 60 %";
 * Requirement "Desglose fiscal de la factura de liquidación…", escenario "4.100 € de total
 * desglosa 3.388,43 base + 711,57 IVA"). design.md §D-2 (`total = importe_liquidacion +
 * Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS NULL)`; desglose reutiliza el dominio puro de
 * US-022, base = round(total/1,21, 2); iva = total − base; iva_porcentaje = 21,00).
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa `@nestjs/*`, Prisma ni
 * infraestructura. Los `subtotal` de los extras ENTRAN congelados por línea (US posteriores);
 * el cálculo SÓLO suma, NO recalcula cantidades ni precios. El `importe_liquidacion` ENTRA
 * congelado de US-021 (60 % MVP): NO se recalcula el porcentaje ni la tarifa. El desglose
 * fiscal se DELEGA en `calcularDesgloseFacturaSenal` de US-022 (base derivada del total, IVA
 * por resta), NO se duplica lógica.
 *
 * RED: aún NO existe `facturacion/domain/calculo-total-liquidacion.ts` con
 * `calcularTotalLiquidacion`. El import falla y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { calcularTotalLiquidacion } from '../calculo-total-liquidacion';
import { calcularDesgloseFacturaSenal } from '../calculo-factura';

// ===========================================================================
// 3.1 — Total de la liquidación: importe_liquidacion + Σ(subtotal de extras con
//        factura_id IS NULL). Los extras ya vienen FILTRADOS (factura_id nulo)
//        por la capa de lectura; el dominio SÓLO suma subtotales congelados.
// ===========================================================================

describe('calcularTotalLiquidacion — suma el 60 % congelado y los extras pendientes (3.1)', () => {
  it('debe_sumar_importe_liquidacion_3600_mas_extras_300_y_200_para_dar_4100', () => {
    // Ejemplo del AC: importe_liquidacion = 3.600,00 + extras (300 + 200) = 4.100,00.
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '3600.00',
      subtotalesExtrasPendientes: ['300.00', '200.00'],
    });

    expect(total).toBe('4100.00');
  });

  it('debe_devolver_solo_el_importe_liquidacion_cuando_no_hay_extras_pendientes', () => {
    // Edge case sin RESERVA_EXTRA con factura_id IS NULL → total = solo el 60 %.
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '3600.00',
      subtotalesExtrasPendientes: [],
    });

    expect(total).toBe('3600.00');
  });

  it('debe_sumar_una_lista_de_varios_extras_sin_perder_centimos', () => {
    // Suma en céntimos enteros (nunca float): 1800,00 + 12,55 + 0,45 + 100,00 = 1913,00.
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '1800.00',
      subtotalesExtrasPendientes: ['12.55', '0.45', '100.00'],
    });

    expect(total).toBe('1913.00');
  });

  it('debe_devolver_siempre_un_decimal_string_de_dos_decimales', () => {
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '3600',
      subtotalesExtrasPendientes: ['500'],
    });

    expect(total).toBe('4100.00');
  });
});

// ===========================================================================
// 3.2 — Desglose fiscal REUTILIZADO de US-022 sobre el total de la liquidación:
//        base = round(total/1,21, 2); iva = total − base; iva_porcentaje = 21,00;
//        base + iva = total EXACTO. NO se duplica la función: se reusa la de señal.
// ===========================================================================

describe('Desglose fiscal reutilizado sobre el total de liquidación 4.100 (3.2)', () => {
  it('debe_desglosar_4100_de_total_en_3388_43_de_base_y_711_57_de_iva', () => {
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '3600.00',
      subtotalesExtrasPendientes: ['300.00', '200.00'],
    });

    const desglose = calcularDesgloseFacturaSenal({ total });

    expect(desglose.total).toBe('4100.00');
    expect(desglose.ivaPorcentaje).toBe('21.00');
    expect(desglose.baseImponible).toBe('3388.43');
    expect(desglose.ivaImporte).toBe('711.57');
    // Invariante contable: base + iva = total EXACTO a 2 decimales.
    expect(Number((Number(desglose.baseImponible) + Number(desglose.ivaImporte)).toFixed(2)))
      .toBe(4100);
  });

  it('debe_desglosar_3600_sin_extras_manteniendo_base_mas_iva_igual_al_total', () => {
    const total = calcularTotalLiquidacion({
      importeLiquidacion: '3600.00',
      subtotalesExtrasPendientes: [],
    });

    const desglose = calcularDesgloseFacturaSenal({ total });

    expect(desglose.total).toBe('3600.00');
    expect(desglose.ivaPorcentaje).toBe('21.00');
    expect(
      Number((Number(desglose.baseImponible) + Number(desglose.ivaImporte)).toFixed(2)),
    ).toBe(3600);
  });
});
