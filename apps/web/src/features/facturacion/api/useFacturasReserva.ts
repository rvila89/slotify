import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { Factura } from '../model/types';

/**
 * Clave de query de la colección de facturas de una reserva. Se exporta para que
 * otras mutaciones puedan invalidar exactamente esta entrada tras un desenlace.
 */
export const facturasReservaQueryKey = (reservaId: string) =>
  ['facturas-reserva', reservaId] as const;

/**
 * Estado de servidor de TODAS las facturas de una reserva (señal, liquidación,
 * fianza) — TanStack Query sobre el SDK generado, operación `listarFacturasReserva`
 * (`GET /reservas/{id}/facturas`). Vista de solo lectura. No se edita el cliente
 * generado a mano.
 *
 * Es la fuente de la que el frontend DERIVA los borradores de liquidación/fianza y
 * la alerta al Gestor de US-027 (no hay endpoint de alerta). Si `fianza_default_eur
 * = 0`, la factura de fianza no existe en la colección y no aparece.
 *
 * El 404 ("la reserva aún no tiene facturas materializadas": el disparo post-commit
 * de US-021 todavía no las creó) NO es error de UI: se resuelve a `[]` para que la
 * vista muestre la preparación en vez de romper. Otros fallos (401/403/red) propagan.
 */
export const useFacturasReserva = (reservaId: string | undefined, habilitado = true) =>
  useQuery({
    queryKey: facturasReservaQueryKey(reservaId ?? ''),
    enabled: Boolean(reservaId) && habilitado,
    queryFn: async (): Promise<Factura[]> => {
      const { data, error, response } = await apiClient.GET('/reservas/{id}/facturas', {
        params: { path: { id: reservaId as string } },
      });
      if (response?.status === 404) return [];
      if (error || !data) {
        throw new Error(
          `No se han podido cargar las facturas de la reserva (${response?.status ?? 'red'})`,
        );
      }
      return data;
    },
  });
