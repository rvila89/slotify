import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { FacturaSenal } from '../model/types';

/**
 * Clave de query de la factura de señal de una reserva. Se exporta para que las
 * mutaciones de aprobar/rechazar/regenerar puedan actualizar/invalidar exactamente
 * esta entrada tras un desenlace exitoso.
 */
export const facturaSenalQueryKey = (reservaId: string) =>
  ['factura-senal', reservaId] as const;

/**
 * Estado de servidor de la factura de señal de una reserva (TanStack Query sobre el
 * SDK generado, `apiClient.GET('/reservas/{id}/factura-senal')`, operación
 * `obtenerFacturaSenal`). No se edita el cliente generado a mano.
 *
 * El 404 ("aún no tiene factura de señal": el disparo post-commit de US-021 todavía
 * no la materializó) NO es un error de UI: se resuelve a `null` para que la card la
 * muestre como "en preparación" en vez de romper. Cualquier otro fallo (401/403/red)
 * sí propaga como error.
 */
export const useFacturaSenal = (reservaId: string | undefined, habilitado = true) =>
  useQuery({
    queryKey: facturaSenalQueryKey(reservaId ?? ''),
    enabled: Boolean(reservaId) && habilitado,
    queryFn: async (): Promise<FacturaSenal | null> => {
      const { data, error, response } = await apiClient.GET('/reservas/{id}/factura-senal', {
        params: { path: { id: reservaId as string } },
      });
      if (response?.status === 404) return null;
      if (error || !data) {
        throw new Error(`No se ha podido cargar la factura de señal (${response?.status ?? 'red'})`);
      }
      return data;
    },
  });
