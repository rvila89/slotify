/**
 * TESTS de la DETECCIÓN DE DISCREPANCIA de importe en el cobro (US-029 / UC-21) — fase TDD
 * RED. tasks.md Fase 3: 3.2.
 *
 * `detectarDiscrepancia` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): compara
 * el importe realmente cobrado con el total facturado y devuelve la discrepancia informativa
 * si difieren, o `null` si coinciden (spec-delta `facturacion` Requirement "Discrepancia de
 * importe alerta pero no bloquea el cobro"; design.md §D-3). NO bloquea: es un valor
 * informativo que el use-case adjunta a la respuesta (`alertaDiscrepancia`) y al AUDIT_LOG.
 *
 * Ambos importes son Decimal(10,2) string (contrato `Importe`). La diferencia se calcula en
 * céntimos enteros (nunca float) y se serializa como string de 2 decimales; sigue la
 * convención del contrato `AlertaDiscrepanciaCobro` (`diferencia = importeFacturado -
 * importeCobrado`).
 *
 * RED: aún NO existe `facturacion/domain/detectar-discrepancia.ts` con
 * `detectarDiscrepancia`. El import falla y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { detectarDiscrepancia } from '../detectar-discrepancia';

// ===========================================================================
// 3.2 — Sin discrepancia: importe cobrado === total facturado → null.
// ===========================================================================

describe('detectarDiscrepancia — sin discrepancia cuando coinciden (3.2)', () => {
  it('debe_devolver_null_cuando_el_importe_cobrado_es_igual_al_facturado', () => {
    expect(detectarDiscrepancia({ importeCobrado: '4100.00', totalFactura: '4100.00' })).toBeNull();
  });

  it('debe_devolver_null_aunque_el_string_de_importe_no_este_normalizado', () => {
    // 4100 y 4100.00 representan el mismo importe: no hay discrepancia real.
    expect(detectarDiscrepancia({ importeCobrado: '4100', totalFactura: '4100.00' })).toBeNull();
  });
});

// ===========================================================================
// 3.2 — Con discrepancia: importe cobrado < facturado → { facturado, cobrado,
//        diferencia = facturado - cobrado }. Caso canónico 4.100 vs 4.000.
// ===========================================================================

describe('detectarDiscrepancia — discrepancia informativa cuando difieren (3.2)', () => {
  it('debe_devolver_la_discrepancia_100_00_cuando_se_cobran_4000_de_4100', () => {
    const discrepancia = detectarDiscrepancia({
      importeCobrado: '4000.00',
      totalFactura: '4100.00',
    });

    expect(discrepancia).not.toBeNull();
    expect(discrepancia).toEqual({
      importeFacturado: '4100.00',
      importeCobrado: '4000.00',
      diferencia: '100.00',
    });
  });

  it('debe_devolver_diferencia_negativa_cuando_se_cobra_de_mas', () => {
    // Se cobran 4.150 de una factura de 4.100: diferencia = 4100 - 4150 = -50,00.
    const discrepancia = detectarDiscrepancia({
      importeCobrado: '4150.00',
      totalFactura: '4100.00',
    });

    expect(discrepancia).not.toBeNull();
    expect(discrepancia?.diferencia).toBe('-50.00');
    expect(discrepancia?.importeFacturado).toBe('4100.00');
    expect(discrepancia?.importeCobrado).toBe('4150.00');
  });

  it('debe_calcular_la_diferencia_en_centimos_sin_perder_decimales', () => {
    const discrepancia = detectarDiscrepancia({
      importeCobrado: '4099.99',
      totalFactura: '4100.00',
    });

    expect(discrepancia?.diferencia).toBe('0.01');
  });
});
