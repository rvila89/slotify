/**
 * TESTS de las VALIDACIONES DE DOMINIO PURO del cobro de la liquidación (US-029 / UC-21
 * pasos 7-10) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * `validarCobro` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa
 * `@nestjs/*`, Prisma ni infraestructura. Valida las dos invariantes previas a crear el
 * PAGO (spec-delta `facturacion` Requirement "Validación de fecha de cobro no futura e
 * importe positivo"; design.md §D-2):
 *   - `importe > 0` (0/negativo → error de dominio `COBRO_INVALIDO`).
 *   - `fecha_cobro <= hoy` (fecha futura → error de dominio `COBRO_INVALIDO`).
 * `hoy` se inyecta (reloj) para determinismo; nunca se lee la fecha real dentro del dominio.
 *
 * El error mapea a HTTP 400 `COBRO_INVALIDO` en el controlador (contrato
 * `CobroLiquidacionError`). El importe llega como Decimal(10,2) string (contrato `Importe`);
 * la aritmética es en céntimos enteros (nunca float).
 *
 * RED: aún NO existe `facturacion/domain/validar-cobro.ts` con `validarCobro` /
 * `CobroInvalidoError`. El import falla y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { validarCobro, CobroInvalidoError } from '../validar-cobro';

const HOY = new Date('2026-06-15T10:00:00.000Z');

// ===========================================================================
// 3.1 — Camino válido: importe > 0 y fecha_cobro <= hoy no lanzan.
// ===========================================================================

describe('validarCobro — importe positivo y fecha no futura (3.1)', () => {
  it('debe_aceptar_un_importe_positivo_con_fecha_de_cobro_igual_a_hoy', () => {
    expect(() =>
      validarCobro({ importe: '4100.00', fechaCobro: new Date('2026-06-15'), hoy: HOY }),
    ).not.toThrow();
  });

  it('debe_aceptar_una_fecha_de_cobro_anterior_a_hoy', () => {
    expect(() =>
      validarCobro({ importe: '4100.00', fechaCobro: new Date('2026-05-01'), hoy: HOY }),
    ).not.toThrow();
  });
});

// ===========================================================================
// 3.1 — Importe no positivo (0 o negativo) → CobroInvalidoError.
// ===========================================================================

describe('validarCobro — el importe debe ser > 0 (3.1)', () => {
  it('debe_rechazar_con_CobroInvalido_cuando_el_importe_es_cero', () => {
    expect(() =>
      validarCobro({ importe: '0.00', fechaCobro: new Date('2026-06-15'), hoy: HOY }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_rechazar_con_CobroInvalido_cuando_el_importe_es_negativo', () => {
    expect(() =>
      validarCobro({ importe: '-10.00', fechaCobro: new Date('2026-06-15'), hoy: HOY }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_exponer_el_codigo_COBRO_INVALIDO_en_el_error_de_importe', () => {
    try {
      validarCobro({ importe: '0.00', fechaCobro: new Date('2026-06-15'), hoy: HOY });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(CobroInvalidoError);
      expect((error as CobroInvalidoError).codigo).toBe('COBRO_INVALIDO');
    }
  });
});

// ===========================================================================
// 3.1 — Fecha de cobro futura → CobroInvalidoError (no se crea PAGO).
// ===========================================================================

describe('validarCobro — la fecha de cobro no puede ser futura (3.1)', () => {
  it('debe_rechazar_con_CobroInvalido_cuando_la_fecha_de_cobro_es_posterior_a_hoy', () => {
    expect(() =>
      validarCobro({ importe: '4100.00', fechaCobro: new Date('2026-06-16'), hoy: HOY }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_rechazar_una_fecha_de_cobro_muy_futura', () => {
    expect(() =>
      validarCobro({ importe: '4100.00', fechaCobro: new Date('2030-01-01'), hoy: HOY }),
    ).toThrow(CobroInvalidoError);
  });
});
