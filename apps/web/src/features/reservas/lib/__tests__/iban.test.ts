import { describe, expect, it } from 'vitest';
import { esIbanValido, normalizarIban } from '../iban';

/**
 * US-035 · FA-01 — validación de IBAN por checksum mod-97 en cliente (espejo de la
 * regla de dominio del backend, para UX). Cubre válido ES, longitud incorrecta,
 * dígitos de control incorrectos, país desconocido, no alfanumérico, vacío y
 * normalización de espacios.
 */
describe('esIbanValido (US-035 mod-97)', () => {
  it('acepta_un_IBAN_espanol_valido', () => {
    expect(esIbanValido('ES9121000418450200051332')).toBe(true);
  });

  it('normaliza_espacios_y_minusculas_antes_de_validar', () => {
    expect(esIbanValido('es91 2100 0418 4502 0005 1332')).toBe(true);
    expect(normalizarIban('es91 2100-0418')).toBe('ES9121000418');
  });

  it('rechaza_longitud_incorrecta_para_el_pais', () => {
    // ES espera 24 caracteres; este tiene menos.
    expect(esIbanValido('ES912100041845020005')).toBe(false);
  });

  it('rechaza_digitos_de_control_incorrectos', () => {
    expect(esIbanValido('ES0021000418450200051332')).toBe(false);
  });

  it('rechaza_pais_desconocido', () => {
    expect(esIbanValido('ZZ9121000418450200051332')).toBe(false);
  });

  it('rechaza_caracteres_no_alfanumericos', () => {
    expect(esIbanValido('ES91-2100_0418*4502')).toBe(false);
  });

  it('rechaza_string_vacio', () => {
    expect(esIbanValido('')).toBe(false);
  });
});
