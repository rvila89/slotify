import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConfirmarPresupuesto } from '../useConfirmarPresupuesto';

/**
 * 3.5 — `useConfirmarPresupuesto` refresca el listado de COMUNICACIONES al confirmar.
 *   Change `presupuesto-confirmar-ux-e2-idioma`, workstream B — fase TDD RED.
 *
 * Trazabilidad: spec-delta `pipeline-ui` (ADDED "Refresco inmediato del listado de
 * comunicaciones al confirmar el presupuesto"): el `onSuccess` DEBE invalidar —además
 * de la query de la RESERVA (`['reserva', id]`)— la query de comunicaciones
 * (`comunicacionesReservaQueryKey(id)` = `['comunicaciones', id]`), reutilizando el
 * patrón de `useCrearEmailManual`/`useDescartarBorrador`.
 *
 * RED: hoy `useConfirmarPresupuesto.onSuccess` SOLO invalida `['reserva', id]`; nunca
 * invalida `['comunicaciones', id]`. La aserción de la invalidación de comunicaciones
 * falla por comportamiento. GREEN es de `frontend-developer`.
 */
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const ok = () => ({
  data: {
    reserva: { idReserva: RESERVA_ID, estado: 'pre_reserva' },
    presupuesto: { idPresupuesto: 'p1', estado: 'enviado' },
  },
  error: undefined,
  response: { status: 201 } as Response,
});

const crearWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
};

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useConfirmarPresupuesto — invalidación de comunicaciones (3.5)', () => {
  it('debe_invalidar_la_query_de_comunicaciones_ademas_de_la_de_la_reserva_tras_exito', async () => {
    postMock.mockResolvedValue(ok());
    const { wrapper, invalidateSpy } = crearWrapper();

    const { result } = renderHook(() => useConfirmarPresupuesto(), { wrapper });

    result.current.mutate({ id: RESERVA_ID, body: {} as never });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Refresca la reserva (comportamiento actual, sigue verde).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reserva', RESERVA_ID] });
    // Y ADEMÁS el listado de comunicaciones (E1 + E2 recién trazados) — RED hoy.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['comunicaciones', RESERVA_ID],
    });
  });
});
