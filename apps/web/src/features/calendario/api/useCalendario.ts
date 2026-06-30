import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { CalendarioResponse, VistaCalendario } from '../model/types';

type Rango = { desde: string; hasta: string };

/**
 * Clave de query del calendario: depende del rango y la vista. La vista es
 * informativa (no altera el conjunto de datos del rango, design §D-1), pero se
 * incluye en la clave para no mezclar caches entre formas de render.
 */
export const calendarioQueryKey = (rango: Rango, vista: VistaCalendario) =>
  ['calendario', rango.desde, rango.hasta, vista] as const;

/**
 * Estado de servidor del calendario (TanStack Query sobre el SDK generado,
 * `apiClient.GET('/calendario')`, única vía a la API; no se edita el cliente
 * generado a mano). El `tenant_id` viaja en el JWT, NUNCA por query (US-039
 * §Aislamiento multi-tenant). `keepPreviousData` evita parpadeos al navegar
 * entre períodos/vistas (US-039 §Cambio de vista: "sin recargar datos
 * innecesariamente" visualmente fluido).
 */
export const useCalendario = (rango: Rango, vista: VistaCalendario) =>
  useQuery({
    queryKey: calendarioQueryKey(rango, vista),
    placeholderData: (previo) => previo,
    queryFn: async (): Promise<CalendarioResponse> => {
      const { data, error, response } = await apiClient.GET('/calendario', {
        params: { query: { desde: rango.desde, hasta: rango.hasta, vista } },
      });
      if (error || !data) {
        throw new Error(`No se ha podido cargar el calendario (${response?.status ?? 'red'})`);
      }
      return data;
    },
  });
