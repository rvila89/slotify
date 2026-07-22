import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { fichaOperativaQueryKey } from './useFichaOperativa';
import type {
  GuardarFichaOperativaRequest,
  GuardarFichaOperativaResponse,
} from '../model/types';

/** Variables del guardado parcial de la ficha operativa (US-025). */
export type GuardarFichaVars = {
  /** ID de la RESERVA, para localizar la query cacheada de su ficha. */
  reservaId: string;
  /** Subconjunto de campos a persistir (PATCH parcial). */
  body: GuardarFichaOperativaRequest;
};

/**
 * Mutación de **guardado parcial** de la ficha operativa (US-025 · UC-20). Consume
 * el SDK generado (`apiClient.PATCH('/reservas/{id}/ficha-operativa')`, operación
 * `guardarFichaOperativa`). Efectos del backend:
 *  - persiste solo el subconjunto de campos enviados (PATCH parcial),
 *  - en el primer guardado con datos transiciona `pre_evento_status: pendiente →
 *    en_curso` (la respuesta trae el `preEventoStatus` resultante),
 *  - la edición post-cierre reescribe `fechaCierre = now()` sin reabrir el estado
 *    (`cerrado` permanece).
 *
 * Tras éxito escribe la ficha devuelta en la caché de la query de la ficha
 * (reflejando el `preEventoStatus`/`fechaCierre` reales y el aforo/duración
 * recalculados) y la invalida. La respuesta incluye además `recalculo` (o `null`):
 * el orquestador lo usa para el aviso de precio actualizado / `tarifaAConsultar`.
 */
export const useGuardarFicha = () => {
  const queryClient = useQueryClient();

  return useMutation<GuardarFichaOperativaResponse, Error, GuardarFichaVars>({
    mutationFn: async ({ reservaId, body }) => {
      const { data, response } = await apiClient.PATCH(
        '/reservas/{id}/ficha-operativa',
        { params: { path: { id: reservaId } }, body },
      );
      if (data) return data;
      throw new Error(
        `No se ha podido guardar la ficha operativa (${response?.status ?? 'red'})`,
      );
    },
    onSuccess: (respuesta, { reservaId }) => {
      // La respuesta es `FichaOperativa & { recalculo }`; para la caché de la query nos
      // basta la parte de ficha (el `recalculo` lo consume el componente, no la caché).
      const { recalculo, ...ficha } = respuesta;
      void recalculo;
      queryClient.setQueryData(fichaOperativaQueryKey(reservaId), {
        tipo: 'disponible',
        ficha,
      });
      void queryClient.invalidateQueries({ queryKey: fichaOperativaQueryKey(reservaId) });
    },
  });
};
