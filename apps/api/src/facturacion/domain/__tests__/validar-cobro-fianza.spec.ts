/**
 * TESTS de las VALIDACIONES DE DOMINIO PURO del cobro de la FIANZA (US-030 / UC-22 pasos 5-9)
 * — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * `validarCobroFianza` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa
 * `@nestjs/*`, Prisma ni infraestructura. Valida las dos invariantes previas a crear el PAGO
 * de la fianza (spec-delta `facturacion` Requirement "Validación de fecha de cobro no posterior
 * al evento e importe positivo"; design.md §D-1 y firmas previstas):
 *   - `importe > 0` (0/negativo → error de dominio `COBRO_INVALIDO`).
 *   - `fecha_cobro <= fecha_evento` (posterior al evento → error de dominio `COBRO_INVALIDO`).
 *
 * A DIFERENCIA de la liquidación (US-029, que validaba `fecha_cobro <= hoy`), la fianza valida
 * `fecha_cobro <= RESERVA.fecha_evento` (relativo al evento, design.md §D-3). La `fechaEvento`
 * se inyecta desde la RESERVA; el dominio nunca lee la fecha real.
 *
 * El error mapea a HTTP 400 `COBRO_INVALIDO` en el controlador (contrato `CobroFianzaError`).
 * El importe llega como Decimal(10,2) string (contrato `Importe`); la aritmética es en céntimos
 * enteros (nunca float).
 *
 * RED: aún NO existe `facturacion/domain/validar-cobro-fianza.ts` con `validarCobroFianza` /
 * `CobroInvalidoError`. El import falla y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { validarCobroFianza, CobroInvalidoError } from '../validar-cobro-fianza';

const FECHA_EVENTO = new Date('2026-07-12');

// ===========================================================================
// 3.1 — Camino válido: importe > 0 y fecha_cobro <= fecha_evento no lanzan.
// ===========================================================================

describe('validarCobroFianza — importe positivo y fecha no posterior al evento (3.1)', () => {
  it('debe_aceptar_un_importe_positivo_con_fecha_de_cobro_anterior_al_evento', () => {
    expect(() =>
      validarCobroFianza({
        importe: '1000.00',
        fechaCobro: new Date('2026-07-10'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).not.toThrow();
  });

  it('debe_aceptar_el_cobro_en_T0_con_fecha_de_cobro_igual_a_la_fecha_del_evento', () => {
    // Cobro en T-0: fecha_cobro = fecha_evento se acepta (design.md §D-3, spec-delta).
    expect(() =>
      validarCobroFianza({
        importe: '1000.00',
        fechaCobro: new Date('2026-07-12'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).not.toThrow();
  });
});

// ===========================================================================
// 3.1 — Importe no positivo (0 o negativo) → CobroInvalidoError.
// ===========================================================================

describe('validarCobroFianza — el importe debe ser > 0 (3.1)', () => {
  it('debe_rechazar_con_CobroInvalido_cuando_el_importe_es_cero', () => {
    expect(() =>
      validarCobroFianza({
        importe: '0.00',
        fechaCobro: new Date('2026-07-10'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_rechazar_con_CobroInvalido_cuando_el_importe_es_negativo', () => {
    expect(() =>
      validarCobroFianza({
        importe: '-10.00',
        fechaCobro: new Date('2026-07-10'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_exponer_el_codigo_COBRO_INVALIDO_en_el_error_de_importe', () => {
    try {
      validarCobroFianza({
        importe: '0.00',
        fechaCobro: new Date('2026-07-10'),
        fechaEvento: FECHA_EVENTO,
      });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(CobroInvalidoError);
      expect((error as CobroInvalidoError).codigo).toBe('COBRO_INVALIDO');
    }
  });
});

// ===========================================================================
// 3.1 — Fecha de cobro posterior al evento → CobroInvalidoError (no se crea PAGO).
// ===========================================================================

describe('validarCobroFianza — la fecha de cobro no puede ser posterior al evento (3.1)', () => {
  it('debe_rechazar_con_CobroInvalido_cuando_la_fecha_de_cobro_es_un_dia_posterior_al_evento', () => {
    expect(() =>
      validarCobroFianza({
        importe: '1000.00',
        fechaCobro: new Date('2026-07-13'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).toThrow(CobroInvalidoError);
  });

  it('debe_rechazar_una_fecha_de_cobro_muy_posterior_al_evento', () => {
    expect(() =>
      validarCobroFianza({
        importe: '1000.00',
        fechaCobro: new Date('2030-01-01'),
        fechaEvento: FECHA_EVENTO,
      }),
    ).toThrow(CobroInvalidoError);
  });
});
