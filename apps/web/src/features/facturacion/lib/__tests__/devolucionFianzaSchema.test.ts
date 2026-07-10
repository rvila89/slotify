import { describe, expect, it } from 'vitest';
import { aImporte, construirEsquemaDevolucion } from '../devolucionFianzaSchema';

/**
 * US-036 — normalización del importe tecleado y validaciones del esquema de cliente de la
 * devolución de fianza. `aImporte` DEBE emitir SIEMPRE un `Importe` Decimal(10,2) válido
 * (patrón `/^\d+\.\d{2}$/`), porque el backend rechaza (400) un entero sin decimales.
 */
describe('aImporte (Bug 1 — normalización a Decimal(10,2))', () => {
  it('normaliza_entero_sin_decimales_a_dos_decimales', () => {
    expect(aImporte('1000')).toBe('1000.00');
    expect(aImporte('0')).toBe('0.00');
  });

  it('normaliza_un_decimal_a_dos_decimales', () => {
    expect(aImporte('1000.5')).toBe('1000.50');
    expect(aImporte('1000,5')).toBe('1000.50');
  });

  it('acepta_coma_como_separador_decimal', () => {
    expect(aImporte('1000,00')).toBe('1000.00');
    expect(aImporte('999,99')).toBe('999.99');
  });

  it('acepta_punto_como_separador_de_miles_y_coma_decimal', () => {
    expect(aImporte('1.000,50')).toBe('1000.50');
    expect(aImporte('1.234.567,89')).toBe('1234567.89');
  });

  it('acepta_punto_como_separador_decimal_directo', () => {
    expect(aImporte('1000.00')).toBe('1000.00');
    expect(aImporte('750.25')).toBe('750.25');
  });

  it('recorta_espacios_antes_de_normalizar', () => {
    expect(aImporte('  1000  ')).toBe('1000.00');
  });

  it('emite_siempre_el_patron_Decimal_10_2', () => {
    for (const entrada of ['1000', '1000,5', '1.000,50', '0', '12.34']) {
      expect(aImporte(entrada)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('no_devuelve_NaN_para_entradas_no_numericas', () => {
    expect(aImporte('')).toBe('');
    expect(aImporte('abc')).toBe('abc');
  });
});

describe('construirEsquemaDevolucion — importe válido tras normalización', () => {
  const esquema = construirEsquemaDevolucion('1000.00', '2026-06-01');

  it('acepta_entero_sin_decimales_igual_a_la_fianza (devolución completa)', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1000',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta_importe_con_coma_decimal', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1000,00',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta_importe_con_separador_de_miles (formato del placeholder "1.000,00")', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1.000,00',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(true);
  });

  it('rechaza_entrada_no_numerica', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: 'abc',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.path.includes('importeDevuelto'))).toBe(true);
    }
  });

  it('FA-02_rechaza_importe_superior_a_la_fianza', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1500',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.path.includes('importeDevuelto'))).toBe(true);
    }
  });

  it('FA-02_acepta_el_límite_exacto_de_la_fianza', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1000.00',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta_cero_como_retención_total', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '0',
      fechaCobro: '2026-06-05',
      motivoRetencion: 'Retención íntegra por daños',
    });
    expect(resultado.success).toBe(true);
  });

  it('exige_motivo_en_devolución_parcial', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '500',
      fechaCobro: '2026-06-05',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.path.includes('motivoRetencion'))).toBe(true);
    }
  });

  it('FA-03_rechaza_fecha_anterior_a_la_de_cobro', () => {
    const resultado = esquema.safeParse({
      importeDevuelto: '1000',
      fechaCobro: '2026-05-30',
      motivoRetencion: '',
    });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.path.includes('fechaCobro'))).toBe(true);
    }
  });
});
