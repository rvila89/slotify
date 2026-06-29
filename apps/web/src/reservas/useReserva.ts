import { useQuery } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';

type ReservaDetalle = components['schemas']['ReservaDetalle'];

/**
 * Clave de query de una reserva concreta. Se exporta para que la mutación de
 * "Añadir fecha" (US-005) pueda invalidar/actualizar exactamente esta entrada
 * tras una transición exitosa.
 */
export const reservaQueryKey = (id: string) => ['reserva', id] as const;

/**
 * Estado de servidor de una reserva (TanStack Query sobre el SDK generado,
 * `apiClient.GET('/reservas/{id}')`, única vía a la API). No se edita el cliente
 * generado a mano.
 */
export const useReserva = (id: string | undefined) =>
  useQuery({
    queryKey: reservaQueryKey(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<ReservaDetalle> => {
      const { data, error, response } = await apiClient.GET('/reservas/{id}', {
        params: { path: { id: id as string } },
      });
      if (error || !data) {
        throw new Error(`No se ha podido cargar la reserva (${response?.status ?? 'red'})`);
      }
      return data;
    },
  });
