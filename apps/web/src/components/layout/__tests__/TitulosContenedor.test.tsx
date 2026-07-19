/**
 * Fase RED — layout-appshell-ancho-titulos-sidebar · T2.
 *
 * Título de contenedor de cada página DISTINTO del título del header (spec-delta
 * `app-shell` §"Título de contenedor distinto del título del header"). El header
 * deriva su etiqueta de `navigation.ts` (Reservas / Histórico / Métricas) y NO se
 * toca; el `<h1>`/título de contenedor de la página debe diferir:
 *   - /reservas   → `<h1>` "Pipeline de solicitudes"  (hoy "Reservas")
 *   - /historico  → `<h1>` "Reservas archivadas"       (hoy "Histórico")
 *   - /metricas   → título del placeholder "Panel de métricas" (hoy "Métricas")
 *
 * RED: los textos actuales son "Reservas", "Histórico" y "Métricas"; las tres
 * aserciones fallan hasta el ajuste 3 de la implementación.
 *
 * Render:
 *  - Reservas e Histórico se montan AISLADOS (QueryClient + MemoryRouter). Su
 *    `<h1>` se pinta con independencia del estado del query, así que se dobla el
 *    SDK con una respuesta estable (lista vacía) para no tocar la red.
 *  - Métricas se monta por la RUTA real vía `<App/>` (es un `SectionPlaceholder`
 *    cuyo título de contenedor llega por la ruta), replicando el patrón de
 *    `AppShellPlaceholder.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import { SessionProvider } from '@/features/auth';
import { ReservasPage } from '@/features/reservas';
import { HistoricoPage } from '@/features/historico';

// El SDK generado se DOBLA: los hooks de ambas páginas llaman a `apiClient.GET`.
// Se devuelve una respuesta estable (lista vacía) para que el árbol sea estable;
// el `<h1>` no depende de estos datos, pero evita cualquier petición real.
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

const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Ada Lovelace', plan: 'Premium' },
} as const;

const nuevoQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderAislado = (ruta: string, ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={nuevoQueryClient()}>
      <MemoryRouter initialEntries={[ruta]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const renderApp = (ruta: string) =>
  render(
    <SessionProvider value={sesionValida}>
      <MemoryRouter initialEntries={[ruta]}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );

afterEach(() => vi.clearAllMocks());

describe('Títulos de contenedor distintos del header (T2)', () => {
  it('reservas_muestra_el_h1_Pipeline_de_solicitudes_no_el_titulo_del_header', () => {
    // Arrange / Act
    renderAislado('/reservas', <ReservasPage />);

    // Assert — el <h1> de contenedor difiere del header ("Reservas")
    expect(
      screen.getByRole('heading', { level: 1, name: /pipeline de solicitudes/i }),
    ).toBeInTheDocument();
  });

  it('historico_muestra_el_h1_Reservas_archivadas_no_el_titulo_del_header', () => {
    // Arrange / Act
    renderAislado('/historico', <HistoricoPage />);

    // Assert — el <h1> de contenedor difiere del header ("Histórico")
    expect(
      screen.getByRole('heading', { level: 1, name: /reservas archivadas/i }),
    ).toBeInTheDocument();
  });

  it('metricas_placeholder_muestra_el_titulo_Panel_de_metricas_no_el_del_header', () => {
    // Arrange / Act — ruta real; el header muestra "Métricas" (navigation.ts).
    renderApp('/metricas');

    // Assert — el título de contenedor del placeholder difiere del header.
    const placeholder = screen.getByTestId('section-placeholder');
    expect(within(placeholder).getByText(/panel de métricas/i)).toBeInTheDocument();
  });
});
