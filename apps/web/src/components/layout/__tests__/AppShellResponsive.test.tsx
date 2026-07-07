/**
 * App Shell responsive (corte en `lg`). En móvil/tablet el sidebar se sirve en
 * un drawer off-canvas (shadcn `Sheet` sobre Radix Dialog) que abre el botón
 * hamburguesa del header.
 *
 * Nota de landmark: con el drawer ABIERTO coexisten 2 `<nav>` en el DOM (el del
 * aside + el del drawer). Por eso este archivo NUNCA usa `getByRole('navigation')`
 * pelado en ese estado: acota siempre con `within(getByRole('dialog'))`. En
 * estado por defecto (cerrado) el Radix Dialog no monta su contenido, así que
 * los tests existentes que esperan UN único `nav` siguen verdes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('App Shell — drawer responsive (< lg)', () => {
  it('el_boton_hamburguesa_abre_el_drawer_y_refleja_el_estado_en_aria_expanded', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    const hamburguesa = screen.getByRole('button', { name: /abrir navegación/i });
    expect(hamburguesa).toHaveAttribute('aria-expanded', 'false');
    // Estado por defecto: drawer cerrado → sin role="dialog".
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(hamburguesa);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(hamburguesa).toHaveAttribute('aria-expanded', 'true');
    // El drawer expone la navegación principal (acotada al dialog).
    expect(within(dialog).getByRole('link', { name: /reservas/i })).toBeInTheDocument();
  });

  it('el_drawer_se_cierra_con_la_tecla_escape', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    await user.click(screen.getByRole('button', { name: /abrir navegación/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /abrir navegación/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('al_pulsar_un_navlink_del_drawer_navega_y_cierra_el_drawer', async () => {
    const user = userEvent.setup();
    renderApp('/calendario');

    await user.click(screen.getByRole('button', { name: /abrir navegación/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('link', { name: /reservas/i }));

    // El outlet cambia a Reservas (SPA). US-050: /reservas ya renderiza la
    // ReservasPage real (no el SectionPlaceholder); verificamos su cabecera <h1>,
    // que se pinta con independencia del estado del query.
    expect(
      await screen.findByRole('heading', { level: 1, name: /reservas/i }),
    ).toBeInTheDocument();

    // ...y el drawer se cierra.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
