import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { Reserva } from '../model/types';

/**
 * Clave de query del pipeline de reservas activas del tenant en sesión. Única y
 * compartida por ambos tabs (Kanban y Listado) de `ReservasPage` (D-3): cambiar
 * de tab NO dispara una segunda llamada porque consumen el mismo `queryKey`.
 */
export const reservasActivasQueryKey = ['reservas', 'activas'] as const;

/**
 * Estado de servidor del pipeline de reservas activas (US-050 · UC-37/UC-38),
 * leído a través del SDK generado (`apiClient.GET('/reservas')`, operationId
 * `listarReservas`; única vía a la API, no se edita el cliente a mano). El
 * backend (US-049) ya excluye estados terminales/cerrados y aísla por tenant.
 *
 * `staleTime: 30_000` evita refetches agresivos al reenfocar/navegar sin dejar
 * la vista demasiado desactualizada. Vista de LECTURA PURA: sin `mutation`.
 */
export const useReservasActivas = () =>
  useQuery({
    queryKey: reservasActivasQueryKey,
    staleTime: 30_000,
    queryFn: async (): Promise<Reserva[]> => {
      const { data, error, response } = await apiClient.GET('/reservas');
      if (error || !data) {
        throw new Error(
          `No se han podido cargar las reservas (${response?.status ?? 'red'}).`,
        );
      }
      return data.data;
    },
  });
