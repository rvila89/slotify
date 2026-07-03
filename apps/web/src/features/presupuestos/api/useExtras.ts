import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { Extra } from '../model/types';

/** Clave de query del catálogo de extras del tenant (lectura pura). */
export const extrasQueryKey = ['extras'] as const;

/**
 * Catálogo de extras del tenant (TanStack Query sobre el SDK generado,
 * `apiClient.GET('/extras')`). Alimenta el selector de extras del borrador de
 * presupuesto (US-014): el gestor añade líneas del catálogo que se envían al
 * motor de tarifa para sumar subtotales. Solo se cargan los `activo=true`.
 * No se edita el cliente generado a mano.
 */
export const useExtras = (habilitado: boolean) =>
  useQuery({
    queryKey: extrasQueryKey,
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Extra[]> => {
      const { data, response } = await apiClient.GET('/extras');
      if (!data) {
        throw new Error(
          `No se ha podido cargar el catálogo de extras (${response?.status ?? 'red'})`,
        );
      }
      return data.filter((extra) => extra.activo !== false);
    },
  });
