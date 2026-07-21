/**
 * Spec del helper PURO `formatearImporteDocumento` (change `factura-pdf-fiel-referencia`,
 * §D7): convierte el string decimal crudo del modelo ("178.51") al formato de importe
 * de los documentos (coma decimal, separador de millares con punto: "178,51",
 * "1.200,00"), fiel a las referencias `F2026029` y `P2026023`.
 *
 * Formatea A PARTIR DEL STRING (split por "."), SIN `parseFloat`, para no arrastrar
 * error de coma flotante en importes monetarios. Determinista, sin dependencia de locale.
 */
import { formatearImporteDocumento } from '../formato-importe';

describe('formatearImporteDocumento — coma decimal y millares con punto', () => {
  it('convierte decimal simple con punto a coma', () => {
    expect(formatearImporteDocumento('178.51')).toBe('178,51');
  });

  it('agrupa millares con punto y decimales con coma', () => {
    expect(formatearImporteDocumento('1200.00')).toBe('1.200,00');
  });

  it('mantiene enteros de tres dígitos sin separador de millares', () => {
    expect(formatearImporteDocumento('216.00')).toBe('216,00');
  });

  it('formatea el cero', () => {
    expect(formatearImporteDocumento('0.00')).toBe('0,00');
  });

  it('agrupa millones con dos separadores de millares', () => {
    expect(formatearImporteDocumento('1234567.89')).toBe('1.234.567,89');
  });

  it('agrupa millares en la frontera exacta de cuatro cifras enteras', () => {
    expect(formatearImporteDocumento('1000.00')).toBe('1.000,00');
  });

  it('no arrastra error de coma flotante en importes monetarios', () => {
    // 4132.23 -> con parseFloat/Intl podría degradarse; el split del string es exacto.
    expect(formatearImporteDocumento('4132.23')).toBe('4.132,23');
  });
});
