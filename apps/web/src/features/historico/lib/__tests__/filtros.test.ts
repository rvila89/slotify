/**
 * US-042 · Histórico — construcción de query y detección de filtros activos.
 *
 * Trazabilidad: design.md D-3 (filtros estructurados AND, default de estadoFinal
 * ausente → solo completadas) y D-5 (estados vacíos diferenciados). Fija el
 * contrato observable de `construirQuery` (omitir vacíos, page/limit siempre) y
 * `hayFiltrosActivos` (diferenciar "sin resultados por filtro" de "sin histórico").
 */
import { describe, expect, it } from 'vitest';
import { construirQuery, hayFiltrosActivos } from '../filtros';
import { FILTROS_INICIALES } from '../constants';

describe('construirQuery', () => {
  it('con los filtros iniciales solo envía page y limit (default de estadoFinal en backend)', () => {
    expect(construirQuery(FILTROS_INICIALES)).toEqual({ page: 1, limit: 20 });
  });

  it('omite los campos vacíos o en blanco', () => {
    const query = construirQuery({
      ...FILTROS_INICIALES,
      q: '   ',
      fechaDesde: '',
      importeMin: '',
    });
    expect(query).toEqual({ page: 1, limit: 20 });
  });

  it('recorta el término de búsqueda y los importes', () => {
    const query = construirQuery({
      ...FILTROS_INICIALES,
      q: '  García  ',
      importeMin: ' 100 ',
    });
    expect(query.q).toBe('García');
    expect(query.importeMin).toBe('100');
  });

  it('propaga todos los filtros estructurados presentes (combinación AND)', () => {
    const query = construirQuery({
      q: 'boda',
      estadoFinal: 'reserva_cancelada',
      fechaDesde: '2026-01-01',
      fechaHasta: '2026-03-31',
      tipoEvento: 'boda',
      importeMin: '1000',
      importeMax: '5000',
      page: 2,
      limit: 50,
    });
    expect(query).toEqual({
      q: 'boda',
      estadoFinal: 'reserva_cancelada',
      fechaDesde: '2026-01-01',
      fechaHasta: '2026-03-31',
      tipoEvento: 'boda',
      importeMin: '1000',
      importeMax: '5000',
      page: 2,
      limit: 50,
    });
  });
});

describe('hayFiltrosActivos', () => {
  it('es false con los filtros iniciales (solo paginación)', () => {
    expect(hayFiltrosActivos(FILTROS_INICIALES)).toBe(false);
  });

  it('es true si hay búsqueda', () => {
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, q: 'García' })).toBe(true);
  });

  it('es true si hay estadoFinal opt-in (canceladas)', () => {
    expect(
      hayFiltrosActivos({ ...FILTROS_INICIALES, estadoFinal: 'reserva_cancelada' }),
    ).toBe(true);
  });

  it('es true si hay rango de fecha o de importe', () => {
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, fechaDesde: '2026-01-01' })).toBe(true);
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, importeMax: '5000' })).toBe(true);
  });
});
