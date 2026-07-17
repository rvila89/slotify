/**
 * US-042 · Histórico — formateo de presentación (cliente, fecha, importe) y
 * segmentado del término para el destacado (D-2). Fija comportamiento observable
 * sin acoplarse a la locale exacta del entorno.
 */
import { describe, expect, it } from 'vitest';
import { formatearFechaEvento, formatearImporte, nombreCliente } from '../formato';
import { segmentosDestacados } from '../destacar';

describe('nombreCliente', () => {
  it('combina nombre y apellidos', () => {
    expect(nombreCliente('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('tolera apellidos ausentes', () => {
    expect(nombreCliente('Ada', null)).toBe('Ada');
  });

  it('devuelve guion largo cuando no hay datos', () => {
    expect(nombreCliente(null, null)).toBe('—');
  });
});

describe('formatearFechaEvento', () => {
  it('devuelve guion largo para nulo o vacío', () => {
    expect(formatearFechaEvento(null)).toBe('—');
    expect(formatearFechaEvento('')).toBe('—');
  });

  it('formatea una fecha ISO a texto en español (incluye el año)', () => {
    expect(formatearFechaEvento('2026-03-15')).toContain('2026');
  });
});

describe('formatearImporte', () => {
  it('devuelve guion largo para nulo/vacío/no numérico', () => {
    expect(formatearImporte(null)).toBe('—');
    expect(formatearImporte('')).toBe('—');
    expect(formatearImporte('abc')).toBe('—');
  });

  it('formatea un string decimal con símbolo de euro', () => {
    expect(formatearImporte('1210.00')).toContain('€');
    expect(formatearImporte('1210.00')).toMatch(/1\.?210/);
  });
});

describe('segmentosDestacados', () => {
  it('sin término devuelve un único segmento sin match', () => {
    expect(segmentosDestacados('García López')).toEqual([{ texto: 'García López', match: false }]);
  });

  it('marca la coincidencia case-insensitive', () => {
    const segs = segmentosDestacados('García López', 'garcía');
    expect(segs.some((s) => s.match && s.texto === 'García')).toBe(true);
    expect(segs.filter((s) => !s.match).map((s) => s.texto).join('')).toBe(' López');
  });

  it('sin coincidencias devuelve el texto sin marcar', () => {
    const segs = segmentosDestacados('García', 'xyz');
    expect(segs.every((s) => !s.match)).toBe(true);
  });
});
