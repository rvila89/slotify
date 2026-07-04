import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { EstadoFicha } from '../model/types';

/**
 * Clave de query de la ficha operativa de una reserva. Se exporta para que las
 * mutaciones de guardar/cerrar puedan actualizar/invalidar exactamente esta entrada
 * tras un desenlace exitoso.
 */
export const fichaOperativaQueryKey = (reservaId: string) =>
  ['ficha-operativa', reservaId] as const;

/**
 * Estado de servidor de la ficha operativa de una reserva (TanStack Query sobre el
 * SDK generado, `apiClient.GET('/reservas/{id}/ficha-operativa')`, operación
 * `leerFichaOperativa`). No se edita el cliente generado a mano.
 *
 * El 409 `ficha_no_disponible` (D-3: la RESERVA aún no está confirmada, la ficha no
 * existe todavía) NO es un error de UI: se resuelve a `{ tipo: 'no-disponible' }`
 * para que la card muestre el mensaje contextual en vez de romper. Cualquier otro
 * fallo (401/404/red) sí propaga como error de query.
 */
export const useFichaOperativa = (reservaId: string | undefined, habilitado = true) =>
  useQuery({
    queryKey: fichaOperativaQueryKey(reservaId ?? ''),
    enabled: Boolean(reservaId) && habilitado,
    queryFn: async (): Promise<EstadoFicha> => {
      const { data, error, response } = await apiClient.GET(
        '/reservas/{id}/ficha-operativa',
        { params: { path: { id: reservaId as string } } },
      );
      if (response?.status === 409) return { tipo: 'no-disponible' };
      if (error || !data) {
        throw new Error(
          `No se ha podido cargar la ficha operativa (${response?.status ?? 'red'})`,
        );
      }
      return { tipo: 'disponible', ficha: data };
    },
  });
