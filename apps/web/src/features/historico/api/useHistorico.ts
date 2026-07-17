import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { FiltrosHistorico, PaginationMetadata, ReservaHistorico } from '../model/types';
import { construirQuery } from '../lib/filtros';

/** Resultado paginado del histórico (envoltorio `{ data, metadata }`). */
export type HistoricoResultado = {
  data: ReservaHistorico[];
  metadata: PaginationMetadata;
};

/**
 * Clave de query del histórico. Incluye los filtros normalizados para que cada
 * combinación (búsqueda, estado, rangos, paginación) tenga su propia entrada de
 * caché y navegar entre páginas/filtros no colisione.
 */
export const historicoQueryKey = (filtros: FiltrosHistorico) =>
  ['historico', construirQuery(filtros)] as const;

/**
 * Estado de servidor del histórico de reservas cerradas (US-042 · UC-32), leído
 * a través del SDK generado (`apiClient.GET('/historico')`, operationId
 * `listarHistorico`; única vía a la API, no se edita el cliente a mano). El
 * backend excluye estados activos/terminales de consulta, aísla por `tenant_id`
 * y aplica el default de `estadoFinal` (ausente → solo `reserva_completada`).
 *
 * `placeholderData: keepPreviousData` mantiene la tabla visible mientras llega la
 * página siguiente, evitando el parpadeo del skeleton al paginar/filtrar. Vista
 * de LECTURA PURA: sin `mutation`.
 */
export const useHistorico = (filtros: FiltrosHistorico) =>
  useQuery({
    queryKey: historicoQueryKey(filtros),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async (): Promise<HistoricoResultado> => {
      const { data, error, response } = await apiClient.GET('/historico', {
        params: { query: construirQuery(filtros) },
      });
      if (error || !data) {
        throw new Error(
          `No se ha podido cargar el histórico (${response?.status ?? 'red'}).`,
        );
      }
      return data;
    },
  });
