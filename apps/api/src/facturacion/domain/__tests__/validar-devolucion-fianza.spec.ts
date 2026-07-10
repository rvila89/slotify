/**
 * TESTS de las VALIDACIONES DE DOMINIO PURO de la DEVOLUCIÓN de la FIANZA (US-036 / UC-27 pasos
 * 4-8) — fase TDD RED. tasks.md Fase 3: 3.1. Paso SIMÉTRICO INVERSO del cobro de fianza (US-030,
 * `validar-cobro-fianza.spec.ts`), calcado en estructura y estilo.
 *
 * `validarDevolucionFianza` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa
 * `@nestjs/*`, Prisma ni infraestructura. Valida las invariantes previas a mutar la RESERVA
 * (spec-delta `facturacion` Requirements "Validación del importe devuelto no superior a la fianza
 * cobrada", "Validación de la fecha de devolución no anterior a la fecha de cobro de la fianza" y
 * "Devolución parcial o retención total … con motivo"; design.md §D-3; firmas previstas):
 *   - `importeDevuelto <= fianzaEur` (superior → `IMPORTE_SUPERA_FIANZA`).
 *   - `importeDevuelto >= 0` (negativo → `IMPORTE_SUPERA_FIANZA`; `0.00` es VÁLIDO — retención total).
 *   - `fechaCobro >= fianzaCobradaFecha` (anterior → `FECHA_DEVOLUCION_INVALIDA`).
 *   - Motivo obligatorio SOLO si el resultado sería `retenida_parcial` (importe < fianzaEur):
 *     ausente/vacío → `MOTIVO_RETENCION_REQUERIDO`.
 *
 * A DIFERENCIA del cobro (US-030, `fecha_cobro <= fecha_evento`), la devolución valida
 * `fecha_cobro >= fianza_cobrada_fecha` (relativo al cobro previo de la fianza, design.md §D-3).
 * La `fianzaEur` y la `fianzaCobradaFecha` se inyectan desde la RESERVA; el dominio nunca lee la
 * fecha real ni consulta infra.
 *
 * Los códigos mapean a HTTP 400 en el controlador (contrato `DevolucionFianzaError`:
 * IMPORTE_SUPERA_FIANZA / FECHA_DEVOLUCION_INVALIDA / MOTIVO_RETENCION_REQUERIDO). Los importes
 * llegan como Decimal(10,2) string (contrato `Importe`); la comparación es en céntimos enteros
 * (NUNCA float), para que `== fianzaEur` no dé falsos negativos.
 *
 * RED: aún NO existe `facturacion/domain/validar-devolucion-fianza.ts` con
 * `validarDevolucionFianza` / las clases de error. El import falla y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  validarDevolucionFianza,
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
} from '../validar-devolucion-fianza';

const FIANZA_COBRADA_FECHA = new Date('2026-05-15');

// ===========================================================================
// 3.1 — Camino válido: importe <= fianzaEur, fecha >= fianza_cobrada_fecha,
//        motivo presente si parcial → no lanza.
// ===========================================================================

describe('validarDevolucionFianza — importe y fecha válidos no lanzan (3.1)', () => {
  it('debe_aceptar_devolucion_completa_importe_igual_a_la_fianza_sin_motivo', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).not.toThrow();
  });

  it('debe_aceptar_la_devolucion_en_T0_con_fecha_cobro_igual_a_la_fecha_de_cobro_de_fianza', () => {
    // La devolución el mismo día del cobro de la fianza (`>=`) se acepta (design.md §D-3).
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-05-15'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).not.toThrow();
  });

  it('debe_aceptar_devolucion_parcial_con_motivo_presente', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1500.00',
        fechaCobro: new Date('2026-06-06'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
        motivoRetencion: 'Daños en vajilla valorados en 500 €',
      }),
    ).not.toThrow();
  });

  it('debe_aceptar_retencion_total_importe_0_00_con_motivo_presente', () => {
    // `0.00` es un valor VÁLIDO (retención total) siempre que haya motivo (spec-delta).
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '0.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-06'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
        motivoRetencion: 'Fianza retenida íntegramente por desperfectos',
      }),
    ).not.toThrow();
  });
});

// ===========================================================================
// 3.1 / FA-02 — importe > fianzaEur o negativo → ImporteSuperaFianzaError.
// ===========================================================================

describe('validarDevolucionFianza — el importe no puede superar la fianza (3.1 / FA-02)', () => {
  it('debe_rechazar_con_ImporteSuperaFianza_cuando_el_importe_supera_la_fianza', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1500.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).toThrow(ImporteSuperaFianzaError);
  });

  it('debe_rechazar_con_ImporteSuperaFianza_cuando_el_importe_es_negativo', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '-10.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).toThrow(ImporteSuperaFianzaError);
  });

  it('debe_exponer_el_codigo_IMPORTE_SUPERA_FIANZA_en_el_error', () => {
    try {
      validarDevolucionFianza({
        importeDevuelto: '1500.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(ImporteSuperaFianzaError);
      expect((error as ImporteSuperaFianzaError).codigo).toBe('IMPORTE_SUPERA_FIANZA');
    }
  });

  it('debe_comparar_en_decimal_no_float_para_no_confundir_1000_01_con_1000_00', () => {
    // 1000.01 > 1000.00 en céntimos enteros: la comparación decimal NO puede aceptarlo.
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.01',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).toThrow(ImporteSuperaFianzaError);
  });
});

// ===========================================================================
// 3.1 / FA-03 — fecha_cobro < fianza_cobrada_fecha → FechaDevolucionInvalidaError.
// ===========================================================================

describe('validarDevolucionFianza — la fecha no puede ser anterior al cobro de fianza (3.1 / FA-03)', () => {
  it('debe_rechazar_con_FechaDevolucionInvalida_cuando_la_fecha_es_un_dia_anterior', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-05-14'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).toThrow(FechaDevolucionInvalidaError);
  });

  it('debe_rechazar_una_fecha_de_devolucion_muy_anterior_al_cobro_de_fianza', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-05-10'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).toThrow(FechaDevolucionInvalidaError);
  });

  it('debe_exponer_el_codigo_FECHA_DEVOLUCION_INVALIDA_en_el_error', () => {
    try {
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-05-10'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(FechaDevolucionInvalidaError);
      expect((error as FechaDevolucionInvalidaError).codigo).toBe('FECHA_DEVOLUCION_INVALIDA');
    }
  });
});

// ===========================================================================
// 3.1 — Motivo requerido solo en el resultado parcial (importe < fianzaEur).
// ===========================================================================

describe('validarDevolucionFianza — el motivo es obligatorio en devolución parcial (3.1)', () => {
  it('debe_rechazar_con_MotivoRetencionRequerido_cuando_es_parcial_y_falta_el_motivo', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1500.00',
        fechaCobro: new Date('2026-06-06'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
        // motivoRetencion ausente
      }),
    ).toThrow(MotivoRetencionRequeridoError);
  });

  it('debe_rechazar_con_MotivoRetencionRequerido_cuando_el_motivo_es_cadena_vacia_o_espacios', () => {
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '0.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-06'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
        motivoRetencion: '   ',
      }),
    ).toThrow(MotivoRetencionRequeridoError);
  });

  it('debe_exponer_el_codigo_MOTIVO_RETENCION_REQUERIDO_en_el_error', () => {
    try {
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1500.00',
        fechaCobro: new Date('2026-06-06'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(MotivoRetencionRequeridoError);
      expect((error as MotivoRetencionRequeridoError).codigo).toBe('MOTIVO_RETENCION_REQUERIDO');
    }
  });

  it('no_debe_exigir_motivo_en_devolucion_completa_importe_igual_a_la_fianza', () => {
    // En `devuelta` (importe == fianzaEur) el motivo se ignora: no debe lanzar por su ausencia.
    expect(() =>
      validarDevolucionFianza({
        importeDevuelto: '1000.00',
        fianzaEur: '1000.00',
        fechaCobro: new Date('2026-06-05'),
        fianzaCobradaFecha: FIANZA_COBRADA_FECHA,
      }),
    ).not.toThrow();
  });
});
