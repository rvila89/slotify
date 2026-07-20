import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { reservaQueryKey } from '../useReserva';
import { useAsignarFecha } from '../useAsignarFecha';
import { useCambiarFecha } from '../useCambiarFecha';

/**
 * RED (change `consulta-fecha-borrador-fix`, design.md §D-4):
 * tras cualquier mutación de fecha (`useAsignarFecha` 2a→2b/2d, `useCambiarFecha` atómico)
 * el `onSuccess` DEBE invalidar TAMBIÉN el query de comunicaciones de la reserva
 * (`comunicacionesReservaQueryKey(id)`), además del de la reserva (`reservaQueryKey(id)`),
 * para que el borrador E1 recién creado (y su contenido) aparezca sin recargar.
 *
 * Hoy ambos hooks SOLO invalidan `reservaQueryKey(id)` → la aserción sobre
 * `comunicacionesReservaQueryKey(id)` falla → ROJO. El SDK generado se DOBLA (sin red).
 */

const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const respuestaOk = (subEstado: string) => ({
  data: { idReserva: RESERVA_ID, estado: 'consulta', subEstado, fechaEvento: '2999-06-01' },
  error: undefined,
  response: { status: 200 } as Response,
});

let queryClient: QueryClient;
// El método `invalidateQueries` es genérico; su spy no encaja en el tipo por defecto
// de `vi.spyOn`, así que se anota con el `MockInstance` genérico (solo se leen las calls).
let invalidateSpy: MockInstance;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

/** Claves invalidadas (aplanadas) para aserciones por igualdad de clave. */
const clavesInvalidadas = () =>
  invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

beforeEach(() => {
  postMock.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  invalidateSpy.mockRestore();
});

describe('useAsignarFecha — invalida el query de comunicaciones tras asignar fecha', () => {
  it('invalida_comunicaciones_ademas_de_la_reserva_en_transicion_2b', async () => {
    postMock.mockResolvedValueOnce(respuestaOk('2b'));
    const { result } = renderHook(() => useAsignarFecha(), { wrapper });

    result.current.mutate({ id: RESERVA_ID, body: { fechaEvento: '2999-06-01' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const claves = clavesInvalidadas();
    expect(claves).toContain(JSON.stringify(reservaQueryKey(RESERVA_ID)));
    expect(claves).toContain(JSON.stringify(comunicacionesReservaQueryKey(RESERVA_ID)));
  });

  it('invalida_comunicaciones_tambien_en_transicion_a_cola_2d', async () => {
    postMock.mockResolvedValueOnce(respuestaOk('2d'));
    const { result } = renderHook(() => useAsignarFecha(), { wrapper });

    result.current.mutate({ id: RESERVA_ID, body: { fechaEvento: '2999-06-01', aceptarCola: true } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(clavesInvalidadas()).toContain(
      JSON.stringify(comunicacionesReservaQueryKey(RESERVA_ID)),
    );
  });
});

describe('useCambiarFecha — invalida el query de comunicaciones tras cambiar fecha', () => {
  it('invalida_comunicaciones_ademas_de_la_reserva', async () => {
    postMock.mockResolvedValueOnce(respuestaOk('2b'));
    const { result } = renderHook(() => useCambiarFecha(), { wrapper });

    result.current.mutate({ id: RESERVA_ID, body: { fechaEvento: '2999-07-01' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const claves = clavesInvalidadas();
    expect(claves).toContain(JSON.stringify(reservaQueryKey(RESERVA_ID)));
    expect(claves).toContain(JSON.stringify(comunicacionesReservaQueryKey(RESERVA_ID)));
  });
});
