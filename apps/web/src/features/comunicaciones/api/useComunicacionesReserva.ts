import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { ComunicacionListItem } from '../model/types';

/**
 * Clave de query del listado de comunicaciones de una reserva. Se exporta para que las
 * mutaciones (enviar/descartar/manual) invaliden exactamente esta entrada tras un
 * desenlace exitoso.
 */
export const comunicacionesReservaQueryKey = (reservaId: string) =>
  ['comunicaciones', reservaId] as const;

/**
 * Estado de servidor del listado de comunicaciones de una RESERVA (sección
 * "Comunicaciones" de la ficha, US-046 · UC-36). TanStack Query sobre el SDK generado
 * (`apiClient.GET('/reservas/{id}/comunicaciones')`, operación `listarComunicacionesReserva`).
 * Devuelve las `ComunicacionListItem` (incluye el flag `accionable`: `true` solo si
 * `estado='borrador'`). No se edita el cliente generado a mano.
 */
export const useComunicacionesReserva = (reservaId: string | undefined) =>
  useQuery({
    queryKey: comunicacionesReservaQueryKey(reservaId ?? ''),
    enabled: Boolean(reservaId),
    queryFn: async (): Promise<ComunicacionListItem[]> => {
      const { data, error, response } = await apiClient.GET('/reservas/{id}/comunicaciones', {
        params: { path: { id: reservaId as string } },
      });
      if (error || !data) {
        throw new Error(
          `No se han podido cargar las comunicaciones (${response?.status ?? 'red'})`,
        );
      }
      return data;
    },
  });
