import { describe, expect, it } from 'vitest';
import {
  aCentimos,
  derivarResultadoDevolucion,
  devolucionYaRegistrada,
  esDevolucionParcial,
  puedeRegistrarDevolucion,
} from '../devolucionFianza';

/**
 * US-036 — reglas de cliente de la devolución de fianza (espejo del dominio del backend).
 */
describe('aCentimos', () => {
  it('convierte_importe_string_a_centimos_enteros', () => {
    expect(aCentimos('1000.00')).toBe(100000);
    expect(aCentimos('1000.50')).toBe(100050);
    expect(aCentimos('0.00')).toBe(0);
  });

  it('null_para_valores_no_numericos_o_ausentes', () => {
    expect(aCentimos(null)).toBeNull();
    expect(aCentimos(undefined)).toBeNull();
    expect(aCentimos('')).toBeNull();
    expect(aCentimos('abc')).toBeNull();
  });
});

describe('derivarResultadoDevolucion (D-3)', () => {
  it('devuelta_cuando_importe_igual_a_fianza', () => {
    expect(derivarResultadoDevolucion('1000.00', '1000.00')).toBe('devuelta');
  });

  it('retenida_parcial_cuando_importe_menor', () => {
    expect(derivarResultadoDevolucion('999.99', '1000.00')).toBe('retenida_parcial');
  });

  it('retenida_parcial_cuando_importe_cero_retencion_total', () => {
    expect(derivarResultadoDevolucion('0.00', '1000.00')).toBe('retenida_parcial');
  });

  it('null_cuando_importe_supera_la_fianza_FA02', () => {
    expect(derivarResultadoDevolucion('1500.00', '1000.00')).toBeNull();
  });

  it('null_cuando_faltan_datos', () => {
    expect(derivarResultadoDevolucion('', '1000.00')).toBeNull();
    expect(derivarResultadoDevolucion('1000.00', null)).toBeNull();
  });

  it('sin_falsos_negativos_de_igualdad_por_coma_flotante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 en float; en céntimos son iguales.
    expect(derivarResultadoDevolucion('0.30', '0.30')).toBe('devuelta');
  });
});

describe('esDevolucionParcial', () => {
  it('true_solo_cuando_es_retenida_parcial', () => {
    expect(esDevolucionParcial('500.00', '1000.00')).toBe(true);
    expect(esDevolucionParcial('0.00', '1000.00')).toBe(true);
    expect(esDevolucionParcial('1000.00', '1000.00')).toBe(false);
    expect(esDevolucionParcial('1500.00', '1000.00')).toBe(false); // inválido, no parcial
  });
});

describe('puedeRegistrarDevolucion (precondición triple, D-4)', () => {
  it('true_en_post_evento_con_fianza_cobrada_e_iban', () => {
    expect(puedeRegistrarDevolucion('post_evento', 'cobrada', 'ES9121000418450200051332')).toBe(true);
  });

  it('false_si_falta_el_iban', () => {
    expect(puedeRegistrarDevolucion('post_evento', 'cobrada', null)).toBe(false);
    expect(puedeRegistrarDevolucion('post_evento', 'cobrada', '   ')).toBe(false);
  });

  it('false_si_no_esta_en_post_evento', () => {
    expect(puedeRegistrarDevolucion('reserva_confirmada', 'cobrada', 'ES91...')).toBe(false);
  });

  it('false_si_la_fianza_no_esta_cobrada', () => {
    expect(puedeRegistrarDevolucion('post_evento', 'pendiente', 'ES91...')).toBe(false);
    expect(puedeRegistrarDevolucion('post_evento', 'devuelta', 'ES91...')).toBe(false);
  });
});

describe('devolucionYaRegistrada (irreversibilidad)', () => {
  it('true_en_estados_finales', () => {
    expect(devolucionYaRegistrada('devuelta')).toBe(true);
    expect(devolucionYaRegistrada('retenida_parcial')).toBe(true);
  });

  it('false_mientras_siga_cobrada_o_pendiente', () => {
    expect(devolucionYaRegistrada('cobrada')).toBe(false);
    expect(devolucionYaRegistrada('pendiente')).toBe(false);
    expect(devolucionYaRegistrada(undefined)).toBe(false);
  });
});
