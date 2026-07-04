/**
 * TESTS del DESCUENTO NEGOCIADO sobre la factura de liquidación — DOMINIO PURO
 * (US-028 / UC-21) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirement "Ajuste del importe
 * (descuento negociado) antes de aprobar", escenario "Un descuento de 200 € emite la
 * factura por 3.900 € con desglose recalculado"). design.md §D-2 (el descuento es
 * MANUAL del Gestor: recalcula `total = total − descuento` y REUTILIZA el desglose
 * fiscal de dominio puro de US-022 — `base = round(total/1,21, 2)`, `iva = total − base`,
 * `iva_porcentaje = 21,00`, `base + iva = total` EXACTO; NO recalcula tarifa ni porcentaje).
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa `@nestjs/*`, Prisma ni
 * infraestructura. El desglose se DELEGA en `calcularDesgloseFacturaSenal` de US-022, NO
 * se duplica lógica de IVA. Opera con céntimos enteros (nunca float).
 *
 * RED: aún NO existe `facturacion/domain/aplicar-descuento-liquidacion.ts` con
 * `aplicarDescuentoLiquidacion`. El import falla y la batería está en ROJO por AUSENCIA
 * DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  aplicarDescuentoLiquidacion,
  DescuentoInvalidoError,
} from '../aplicar-descuento-liquidacion';

// ===========================================================================
// 3.1 — El AC canónico: total 4.100 − descuento 200 = 3.900, con el desglose
//        fiscal recalculado (base 3.223,14 / IVA 676,86) y base + iva = total.
// ===========================================================================

describe('aplicarDescuentoLiquidacion — descuento negociado recalcula total + desglose (3.1)', () => {
  it('debe_dejar_total_3900_base_3223_14_iva_676_86_al_restar_200_de_4100', () => {
    const resultado = aplicarDescuentoLiquidacion({ total: '4100.00' }, '200.00');

    expect(resultado.total).toBe('3900.00');
    expect(resultado.baseImponible).toBe('3223.14');
    expect(resultado.ivaPorcentaje).toBe('21.00');
    expect(resultado.ivaImporte).toBe('676.86');
    // Invariante contable: base + iva = total EXACTO a 2 decimales.
    expect(Number((Number(resultado.baseImponible) + Number(resultado.ivaImporte)).toFixed(2)))
      .toBe(3900);
  });

  it('debe_devolver_el_total_original_desglosado_cuando_el_descuento_es_cero', () => {
    const resultado = aplicarDescuentoLiquidacion({ total: '4100.00' }, '0.00');

    expect(resultado.total).toBe('4100.00');
    expect(resultado.baseImponible).toBe('3388.43');
    expect(resultado.ivaImporte).toBe('711.57');
  });

  it('debe_restar_en_centimos_enteros_sin_perder_decimales', () => {
    // 3.900,55 − 0,55 = 3.900,00 exacto (nunca aritmética float).
    const resultado = aplicarDescuentoLiquidacion({ total: '3900.55' }, '0.55');

    expect(resultado.total).toBe('3900.00');
  });

  it('debe_normalizar_el_total_resultante_a_dos_decimales', () => {
    const resultado = aplicarDescuentoLiquidacion({ total: '4100' }, '200');

    expect(resultado.total).toBe('3900.00');
  });
});

// ===========================================================================
// 3.1 — Guardas del descuento (D-2): no negativo y no puede dejar el total en
//        cero o negativo. Es una función pura → error de dominio tipado.
// ===========================================================================

describe('aplicarDescuentoLiquidacion — guardas del descuento (3.1)', () => {
  it('debe_rechazar_con_DescuentoInvalido_cuando_el_descuento_es_negativo', () => {
    expect(() => aplicarDescuentoLiquidacion({ total: '4100.00' }, '-10.00')).toThrow(
      DescuentoInvalidoError,
    );
  });

  it('debe_rechazar_con_DescuentoInvalido_cuando_deja_el_total_en_cero', () => {
    expect(() => aplicarDescuentoLiquidacion({ total: '4100.00' }, '4100.00')).toThrow(
      DescuentoInvalidoError,
    );
  });

  it('debe_rechazar_con_DescuentoInvalido_cuando_supera_el_total', () => {
    expect(() => aplicarDescuentoLiquidacion({ total: '4100.00' }, '5000.00')).toThrow(
      DescuentoInvalidoError,
    );
  });
});
