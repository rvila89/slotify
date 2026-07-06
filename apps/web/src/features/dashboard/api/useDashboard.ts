import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { DashboardResponse } from '../model/types';

/**
 * Error de carga del dashboard. Vista de LECTURA PURA (US-044): no muta estado,
 * así que solo distinguimos "cargado" de "fallo genérico" (red/servidor). El
 * aislamiento por tenant lo aplica el backend vía JWT + RLS, sin parámetros.
 */
export class DashboardError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DashboardError';
  }
}

/** Clave de query del dashboard operativo del tenant en sesión. */
export const dashboardQueryKey = ['dashboard'] as const;

/**
 * Estado de servidor del dashboard operativo (US-044 · UC-34), leído a través
 * del SDK generado (`apiClient.GET('/dashboard')`, operationId
 * `consultarDashboard`; única vía a la API, no se edita el cliente a mano).
 *
 * El dashboard NO necesita tiempo real: `staleTime` de 60 s evita refetches
 * agresivos al reenfocar/navegar (design US-044). Es una única llamada agregada
 * (design §D-1: un endpoint en vez de 7). Sin `mutation` (solo lectura).
 */
export const useDashboard = () =>
  useQuery({
    queryKey: dashboardQueryKey,
    staleTime: 60_000,
    queryFn: async (): Promise<DashboardResponse> => {
      const { data, error, response } = await apiClient.GET('/dashboard');
      if (error || !data) {
        throw new DashboardError(
          `No se ha podido cargar el dashboard (${response.status || 'red'}).`,
        );
      }
      return data;
    },
  });
