import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { FacturaLiquidacion } from '../model/types';

/**
 * Clave de query de la factura de liquidación de una reserva. Se exporta para que las
 * mutaciones de enviar/reenviar puedan invalidar exactamente esta entrada tras un
 * desenlace exitoso.
 */
export const facturaLiquidacionQueryKey = (reservaId: string) =>
  ['factura-liquidacion', reservaId] as const;

/**
 * Estado de servidor de la factura de liquidación de una reserva (TanStack Query sobre el
 * SDK generado, `apiClient.GET('/reservas/{id}/factura-liquidacion')`, operación
 * `obtenerFacturaLiquidacion`). Espejo de `useFacturaSenal`. No se edita el cliente generado
 * a mano.
 *
 * El 404 ("aún no tiene factura de liquidación": el borrador post-commit de US-027 todavía no
 * se materializó) NO es un error de UI: se resuelve a `null` para que la card la muestre como
 * "en preparación" en vez de romper. Cualquier otro fallo (401/403/red) sí propaga como error.
 */
export const useFacturaLiquidacion = (reservaId: string | undefined, habilitado = true) =>
  useQuery({
    queryKey: facturaLiquidacionQueryKey(reservaId ?? ''),
    enabled: Boolean(reservaId) && habilitado,
    queryFn: async (): Promise<FacturaLiquidacion | null> => {
      const { data, error, response } = await apiClient.GET(
        '/reservas/{id}/factura-liquidacion',
        { params: { path: { id: reservaId as string } } },
      );
      if (response?.status === 404) return null;
      if (error || !data) {
        throw new Error(
          `No se ha podido cargar la factura de liquidación (${response?.status ?? 'red'})`,
        );
      }
      return data;
    },
  });
