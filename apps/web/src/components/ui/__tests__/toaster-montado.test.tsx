/**
 * Regresión: el host global de toasts (Sonner `<Toaster/>`) DEBE estar montado en
 * el árbol de la app. Sin él, NINGUNA llamada `toast.*()` se renderiza — bug real
 * observado: el alert de éxito al descartar una consulta no aparecía porque el
 * `<Toaster/>` de `components/ui/sonner.tsx` nunca se montaba en `App`.
 *
 * Verifica la conducta de usuario: con la app montada, un `toast.success` produce
 * su mensaje en el DOM.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import App from '@/App';
import { SessionProvider } from '@/features/auth';

const sesionValida = {
  status: 'authenticated',
  user: { nombre: 'Ada Lovelace', plan: 'Premium' },
} as const;

describe('Host global de toasts (Sonner) montado en App', () => {
  it('debe_renderizar_un_toast_success_cuando_la_app_esta_montada', async () => {
    render(
      <SessionProvider value={sesionValida}>
        <MemoryRouter initialEntries={['/metricas']}>
          <App />
        </MemoryRouter>
      </SessionProvider>,
    );

    act(() => {
      toast.success('Mensaje de prueba de toast');
    });

    expect(await screen.findByText('Mensaje de prueba de toast')).toBeInTheDocument();
  });
});
