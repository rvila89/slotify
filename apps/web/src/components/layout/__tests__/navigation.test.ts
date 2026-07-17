/**
 * `resolveSectionMeta`: mapea una ruta al título/subtítulo dinámico del header.
 * Usa match por prefijo más largo, de modo que las sub-rutas heredan la meta de
 * su sección padre, y cae a un valor por defecto para rutas fuera del menú.
 */
import { describe, expect, it } from 'vitest';
import { resolveSectionMeta } from '../navigation';

describe('resolveSectionMeta', () => {
  it('devuelve la meta exacta de cada sección del menú', () => {
    expect(resolveSectionMeta('/dashboard')).toEqual({
      title: 'Dashboard',
      subtitle: 'Vista general de la operación',
    });
    expect(resolveSectionMeta('/calendario').title).toBe('Calendario');
    expect(resolveSectionMeta('/historico').title).toBe('Histórico');
    expect(resolveSectionMeta('/metricas').title).toBe('Métricas');
  });

  it('hace que el detalle del histórico herede la meta de su sección padre', () => {
    expect(resolveSectionMeta('/historico/abc-123').title).toBe('Histórico');
  });

  it('hace que las sub-rutas hereden la meta de su sección padre', () => {
    expect(resolveSectionMeta('/reservas/nueva').title).toBe('Reservas');
    expect(resolveSectionMeta('/reservas/abc-123').title).toBe('Reservas');
    expect(resolveSectionMeta('/reservas/abc-123/cola').title).toBe('Reservas');
  });

  it('cae al valor por defecto para rutas fuera del menú', () => {
    expect(resolveSectionMeta('/ruta-inexistente')).toEqual({
      title: 'Panel',
      subtitle: 'Gestión de reservas',
    });
  });
});
