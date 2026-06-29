/**
 * Fase RED — US-000A · App Shell
 * Task 2.5: una seccion conocida pero AUN NO IMPLEMENTADA (su contenido funcional
 * llega en otra US) muestra un placeholder coherente con el layout, sin romper la
 * navegacion.
 *
 * Contrato de produccion (fase GREEN):
 *  - Las secciones del MVP (Calendario US-039, Reservas US-042, Métricas US-044)
 *    renderizan, mientras no esten construidas, un placeholder con
 *    `data-testid="section-placeholder"` que incluye el nombre de la seccion.
 *  - Distinto del catch-all (task 2.4): el placeholder es una ruta CONOCIDA;
 *    "no encontrado" es una ruta DESCONOCIDA.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

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

describe('App Shell — placeholder de seccion no implementada', () => {
  it('debe_mostrar_placeholder_de_la_seccion_sin_romper_la_nav', () => {
    // Arrange / Act: seccion conocida (Métricas) cuyo contenido aun no existe.
    renderApp('/metricas');

    // Assert: placeholder coherente con el layout, identificando la seccion...
    const placeholder = screen.getByTestId('section-placeholder');
    expect(within(placeholder).getByText(/m[eé]tricas/i)).toBeInTheDocument();

    // ...y no es el estado "no encontrado" (eso es para rutas desconocidas).
    expect(screen.queryByText(/no encontrado/i)).not.toBeInTheDocument();

    // ...la nav lateral sigue operativa.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /calendario/i })).toBeInTheDocument();
  });
});
