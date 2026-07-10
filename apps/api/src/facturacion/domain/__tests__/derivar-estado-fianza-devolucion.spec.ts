/**
 * TESTS de la DERIVACIÓN DEL ESTADO FINAL de la fianza tras la devolución — MÁQUINA DE ESTADOS de
 * dominio puro (US-036 / UC-27) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * `derivarEstadoFianzaDevolucion` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`) que
 * deriva el estado final de la fianza a partir del importe devuelto y la fianza cobrada, como
 * ESTRUCTURA/regla de datos, NO como código disperso (CLAUDE.md §Máquina de estados). El estado
 * final NO lo elige el Gestor: lo deriva el dominio (spec-delta `facturacion` Requirement
 * "Registro de la devolución … con derivación del estado final", scenario "El estado final se
 * deriva del importe, no lo elige el Gestor"; design.md §D-3):
 *   - `importeDevuelto == fianzaEur` ⇒ `'devuelta'` (devolución completa).
 *   - `importeDevuelto < fianzaEur` (incluido `0.00`) ⇒ `'retenida_parcial'` (parcial / retención
 *     total).
 *
 * La comparación se hace con precisión DECIMAL de 2 posiciones (céntimos enteros), NUNCA float,
 * para que `== fianzaEur` no dé falsos negativos de igualdad. La validación de que
 * `importeDevuelto <= fianzaEur` vive en `validarDevolucionFianza` (aquí se asume ya validado, se
 * ejercita SOLO la derivación en el rango válido `0 <= x <= fianzaEur`).
 *
 * RED: aún NO existe `facturacion/domain/derivar-estado-fianza-devolucion.ts`. El import falla y
 * la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { derivarEstadoFianzaDevolucion } from '../derivar-estado-fianza-devolucion';

// ===========================================================================
// 3.2 — importe == fianzaEur ⇒ 'devuelta' (devolución completa).
// ===========================================================================

describe('derivarEstadoFianzaDevolucion — importe igual a la fianza deriva devuelta (3.2)', () => {
  it('debe_derivar_devuelta_cuando_el_importe_es_igual_a_la_fianza', () => {
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '1000.00',
      fianzaEur: '1000.00',
    });

    expect(estado).toBe('devuelta');
  });

  it('debe_derivar_devuelta_con_otro_importe_completo_1500', () => {
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '1500.00',
      fianzaEur: '1500.00',
    });

    expect(estado).toBe('devuelta');
  });

  it('debe_comparar_en_decimal_no_float_para_no_confundir_999_99_con_1000_00', () => {
    // 999.99 < 1000.00 en céntimos: es PARCIAL, no completa. Un `parseFloat` descuidado fallaría.
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '999.99',
      fianzaEur: '1000.00',
    });

    expect(estado).toBe('retenida_parcial');
  });
});

// ===========================================================================
// 3.2 — importe < fianzaEur (incluido 0.00) ⇒ 'retenida_parcial'.
// ===========================================================================

describe('derivarEstadoFianzaDevolucion — importe menor deriva retenida_parcial (3.2)', () => {
  it('debe_derivar_retenida_parcial_cuando_el_importe_es_menor_que_la_fianza', () => {
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '1000.00',
      fianzaEur: '1500.00',
    });

    expect(estado).toBe('retenida_parcial');
  });

  it('debe_derivar_retenida_parcial_en_la_retencion_total_importe_0_00', () => {
    // Retención total: `fianza_devuelta_eur = 0.00` sigue siendo `retenida_parcial` (spec-delta).
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '0.00',
      fianzaEur: '1000.00',
    });

    expect(estado).toBe('retenida_parcial');
  });

  it('debe_derivar_retenida_parcial_por_un_solo_centimo_de_diferencia', () => {
    const estado = derivarEstadoFianzaDevolucion({
      importeDevuelto: '1499.99',
      fianzaEur: '1500.00',
    });

    expect(estado).toBe('retenida_parcial');
  });
});
