/**
 * TESTS de la DERIVACIÓN régimen←método de pago — DOMINIO PURO (épico #6, rebanada
 * 6.2 `documentos-presupuesto-sin-iva-doble-numeracion`) — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirement "Método de pago del presupuesto
 * determina el régimen fiscal"; escenarios "Transferencia genera régimen CON IVA",
 * "Efectivo genera régimen SIN IVA", "La derivación régimen←método es una función de
 * dominio pura"); design.md D1 (enums `RegimenIva {con_iva,sin_iva}` +
 * `MetodoPago {transferencia,efectivo}`; mapa declarativo, no `if` disperso).
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): mapea el método de pago elegido
 * por el gestor al régimen fiscal derivado mediante una estructura de datos declarativa.
 * No importa `@nestjs/*` ni Prisma.
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`presupuestos/domain/
 * regimen-desde-metodo-pago.ts`):
 *   - `enum`/tipo `RegimenIva`  con valores literales `'con_iva' | 'sin_iva'`.
 *   - `enum`/tipo `MetodoPago`  con valores literales `'transferencia' | 'efectivo'`.
 *   - `regimenDesdeMetodoPago(metodoPago: MetodoPago): RegimenIva` (arrow, mapa).
 *
 * RED: aún NO existe `presupuestos/domain/regimen-desde-metodo-pago.ts`. El import
 * falla (TS2307) y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  regimenDesdeMetodoPago,
  type MetodoPago,
  type RegimenIva,
} from '../regimen-desde-metodo-pago';

// ===========================================================================
// 3.1 — Mapa declarativo: transferencia → con_iva, efectivo → sin_iva.
// ===========================================================================

describe('regimenDesdeMetodoPago — deriva el régimen fiscal del método de pago (3.1)', () => {
  it('debe_derivar_regimen_con_iva_cuando_el_metodo_es_transferencia', () => {
    // Arrange
    const metodo: MetodoPago = 'transferencia';

    // Act
    const regimen: RegimenIva = regimenDesdeMetodoPago(metodo);

    // Assert — transferencia ⇒ CON IVA (regla del Excel del tenant).
    expect(regimen).toBe('con_iva');
  });

  it('debe_derivar_regimen_sin_iva_cuando_el_metodo_es_efectivo', () => {
    // Arrange
    const metodo: MetodoPago = 'efectivo';

    // Act
    const regimen: RegimenIva = regimenDesdeMetodoPago(metodo);

    // Assert — efectivo ⇒ SIN IVA (el cliente en efectivo paga sin el 21%).
    expect(regimen).toBe('sin_iva');
  });

  it.each([
    ['transferencia', 'con_iva'],
    ['efectivo', 'sin_iva'],
  ] as ReadonlyArray<[MetodoPago, RegimenIva]>)(
    'debe_mapear_%s_a_%s_de_forma_total_y_deterministica',
    (metodo, esperado) => {
      expect(regimenDesdeMetodoPago(metodo)).toBe(esperado);
    },
  );

  it('debe_cubrir_los_dos_metodos_de_pago_del_dominio_sin_dejar_ninguno_sin_regimen', () => {
    // El mapa es TOTAL: todo MetodoPago del dominio produce un RegimenIva válido.
    const metodos: ReadonlyArray<MetodoPago> = ['transferencia', 'efectivo'];
    const regimenesValidos: ReadonlyArray<RegimenIva> = ['con_iva', 'sin_iva'];

    for (const metodo of metodos) {
      expect(regimenesValidos).toContain(regimenDesdeMetodoPago(metodo));
    }
  });
});
