/**
 * App Shell — sidebar integrado colapsable. El `<aside>` vive en el flujo del
 * layout (no es un overlay/modal): anima su ancho al abrir/cerrar con el logo
 * del header y persiste al navegar.
 *
 * Nota de landmark: colapsado el `<aside>` queda `aria-hidden`, así que su
 * `<nav>` NO está en el árbol de accesibilidad (los role-queries por defecto no
 * lo ven). Al abrir, el `<nav>` pasa a ser accesible.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

// US-050: /reservas ya monta ReservasPage, que consume el SDK. Se DOBLA solo el
// `GET` (conservando el resto del cliente real, p. ej. `.use` del interceptor)
// para que la navegación a la sección no dispare una petición real. Devuelve una
// lista vacía → estado estable de la página.
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

const renderApp = (initial: string) =>
  render(
    <SessionProvider value={sesionValida}>
      <MemoryRouter initialEntries={[initial]}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );

describe('App Shell — sidebar integrado colapsable', () => {
  it('el_logo_alterna_el_sidebar_y_refleja_el_estado_en_aria_expanded', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    const toggle = screen.getByRole('button', { name: /navegación/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Estado por defecto: colapsado → el <nav> no está en el árbol de a11y.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    // Abrir: aparece la navegación principal.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: /reservas/i })).toBeInTheDocument();

    // Cerrar con el mismo logo: vuelve a colapsar (sin nav accesible).
    await user.click(screen.getByRole('button', { name: /navegación/i }));
    expect(screen.getByRole('button', { name: /navegación/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('al_pulsar_un_navlink_navega_pero_el_sidebar_permanece_abierto', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    await user.click(screen.getByRole('button', { name: /navegación/i }));
    const nav = await screen.findByRole('navigation');

    await user.click(within(nav).getByRole('link', { name: /reservas/i }));

    // El outlet cambia a Reservas (SPA). US-050: /reservas ya renderiza la
    // ReservasPage real (no el SectionPlaceholder); verificamos su cabecera <h1>.
    expect(
      await screen.findByRole('heading', { level: 1, name: /reservas/i }),
    ).toBeInTheDocument();

    // ...y el sidebar permanece abierto (integrado, no modal): la nav sigue
    // accesible y el toggle sigue expandido.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /navegación/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
