import { describe, expect, it } from 'vitest';
import { puedeRegistrarIban, tieneFianza } from '../ibanDevolucion';

/**
 * US-035 · FA-04 — la acción "Registrar IBAN" solo aplica en `post_evento` con fianza
 * cobrada (`fianza_eur > 0`). `fianzaEur` llega como `Importe` string Decimal.
 */
describe('puedeRegistrarIban (US-035 FA-04)', () => {
  it('permite_en_post_evento_con_fianza_positiva', () => {
    expect(puedeRegistrarIban('post_evento', '1000.00')).toBe(true);
  });

  it('rechaza_sin_fianza_cero', () => {
    expect(puedeRegistrarIban('post_evento', '0.00')).toBe(false);
  });

  it('rechaza_fianza_null_o_undefined', () => {
    expect(puedeRegistrarIban('post_evento', null)).toBe(false);
    expect(puedeRegistrarIban('post_evento', undefined)).toBe(false);
  });

  it('rechaza_fuera_de_post_evento_aunque_haya_fianza', () => {
    expect(puedeRegistrarIban('reserva_confirmada', '1000.00')).toBe(false);
    expect(puedeRegistrarIban('evento_en_curso', '1000.00')).toBe(false);
  });

  it('tieneFianza_interpreta_el_importe_string', () => {
    expect(tieneFianza('0.01')).toBe(true);
    expect(tieneFianza('0')).toBe(false);
    expect(tieneFianza(null)).toBe(false);
  });
});
