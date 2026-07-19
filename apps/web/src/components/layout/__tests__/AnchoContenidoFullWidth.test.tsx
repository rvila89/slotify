/**
 * Fase RED — layout-appshell-ancho-titulos-sidebar · T3 (opcional).
 *
 * El área de contenido fluye a ANCHO COMPLETO de forma uniforme (spec-delta
 * `app-shell` §"El área de contenido fluye a ancho completo…"): el contenedor
 * raíz de cada página NO debe llevar tope `max-w-[1200px]` ni centrado `mx-auto`.
 *
 * RED: hoy `DashboardPage` e `HistoricoPage` envuelven en
 * `mx-auto flex w-full max-w-[1200px] flex-col gap-6`, así que las aserciones
 * `not.toContain('max-w-[1200px]')` y `not.toContain('mx-auto')` fallan.
 *
 * Se inspecciona la `className` del nodo raíz (`container.firstChild`), que es el
 * `<div>` contenedor que envuelve el `<header>` y el contenido de la página.
 * Se dobla el SDK para no tocar la red; las clases del contenedor no dependen del
 * estado del query.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '@/features/dashboard';
import { HistoricoPage } from '@/features/historico';

vi.mock('@/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/api-client')>('@/api-client');
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      GET: vi.fn().mockResolvedValue({
        data: { data: [], metadata: { total: 0, page: 1, pageSize: 20 } },
        error: undefined,
        response: { status: 200 },
      }),
    },
  };
});

const nuevoQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderPagina = (ruta: string, ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={nuevoQueryClient()}>
      <MemoryRouter initialEntries={[ruta]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const claseRaiz = (nodo: ChildNode | null) => {
  if (!(nodo instanceof HTMLElement)) throw new Error('El nodo raíz no es un HTMLElement');
  return nodo.className;
};

afterEach(() => vi.clearAllMocks());

describe('Ancho de contenido a full-width sin tope (T3)', () => {
  it('dashboard_no_topa_el_ancho_ni_centra_el_contenedor_raiz', () => {
    // Arrange / Act
    const { container } = renderPagina('/dashboard', <DashboardPage />);

    // Assert — sin tope de ancho ni centrado
    const clase = claseRaiz(container.firstChild);
    expect(clase).not.toContain('max-w-[1200px]');
    expect(clase).not.toContain('mx-auto');
  });

  it('historico_no_topa_el_ancho_ni_centra_el_contenedor_raiz', () => {
    // Arrange / Act
    const { container } = renderPagina('/historico', <HistoricoPage />);

    // Assert — sin tope de ancho ni centrado
    const clase = claseRaiz(container.firstChild);
    expect(clase).not.toContain('max-w-[1200px]');
    expect(clase).not.toContain('mx-auto');
  });
});
