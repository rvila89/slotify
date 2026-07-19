/**
 * Fase RED — layout-appshell-ancho-titulos-sidebar · T1.
 *
 * Estado INICIAL del menú lateral del App Shell derivado del viewport en el
 * primer render (inicialización perezosa, spec-delta `app-shell` §"El menú
 * lateral arranca abierto/cerrado"):
 *   - viewport de escritorio (innerWidth ≥ 1024): el `<aside>` arranca ABIERTO
 *     → `aria-hidden="false"` y SIN atributo `inert`.
 *   - viewport estrecho (innerWidth < 1024, p. ej. 390 o 768): el `<aside>`
 *     arranca CERRADO → `aria-hidden="true"` y CON atributo `inert`.
 *
 * RED: hoy `AppShell.tsx` inicializa `useState(false)` (siempre cerrado), de modo
 * que en escritorio (≥ 1024) el aside sigue cerrado y la aserción de "abierto"
 * falla. No mide clases de ancho: mide los atributos de a11y (`aria-hidden` /
 * `inert`) que el propio componente ya expone según `open`.
 *
 * Se consulta el `<aside id="app-shell-sidebar">` por su `id` con
 * `document.getElementById` porque, colapsado, queda fuera del árbol de a11y y
 * los role-queries no lo alcanzan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

// /reservas monta ReservasPage, que consume el SDK. Se DOBLA solo el `GET`
// (conservando el resto del cliente real) para que ninguna ruta dispare red.
// Aquí montamos en /calendario, pero se deja el doble por robustez del árbol.
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

const anchoOriginal = window.innerWidth;

const fijarAncho = (px: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
};

const renderApp = () =>
  render(
    <SessionProvider value={sesionValida}>
      <MemoryRouter initialEntries={['/calendario']}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );

const asideDelShell = () => {
  const aside = document.getElementById('app-shell-sidebar');
  if (!aside) throw new Error('No se encontró el <aside id="app-shell-sidebar">');
  return aside;
};

afterEach(() => {
  fijarAncho(anchoOriginal);
  vi.clearAllMocks();
});

describe('App Shell — estado inicial del sidebar por viewport (T1)', () => {
  describe('en escritorio (innerWidth ≥ 1024)', () => {
    beforeEach(() => fijarAncho(1280));

    it('debe_arrancar_abierto_el_sidebar_al_montar_con_viewport_de_escritorio', () => {
      // Arrange / Act
      renderApp();

      // Assert — abierto: aria-hidden=false y sin inert
      const aside = asideDelShell();
      expect(aside).toHaveAttribute('aria-hidden', 'false');
      expect(aside).not.toHaveAttribute('inert');
    });
  });

  describe('en móvil (innerWidth 390, < 1024)', () => {
    beforeEach(() => fijarAncho(390));

    it('debe_arrancar_cerrado_el_sidebar_al_montar_con_viewport_movil', () => {
      // Arrange / Act
      renderApp();

      // Assert — cerrado: aria-hidden=true y con inert
      const aside = asideDelShell();
      expect(aside).toHaveAttribute('aria-hidden', 'true');
      expect(aside).toHaveAttribute('inert');
    });
  });

  describe('en tablet estrecho (innerWidth 768, < 1024)', () => {
    beforeEach(() => fijarAncho(768));

    it('debe_arrancar_cerrado_el_sidebar_al_montar_con_viewport_tablet', () => {
      // Arrange / Act
      renderApp();

      // Assert — cerrado: aria-hidden=true y con inert
      const aside = asideDelShell();
      expect(aside).toHaveAttribute('aria-hidden', 'true');
      expect(aside).toHaveAttribute('inert');
    });
  });
});
