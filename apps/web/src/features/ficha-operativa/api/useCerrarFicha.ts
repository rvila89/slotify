import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { fichaOperativaQueryKey } from './useFichaOperativa';
import type { CerrarFichaOperativaResponse } from '../model/types';

/** Variables del cierre de la ficha operativa (US-025). */
export type CerrarFichaVars = {
  /** ID de la RESERVA cuya ficha se cierra. */
  reservaId: string;
};

/**
 * Mutación de **cierre** de la ficha operativa (US-025 · UC-20). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/ficha-operativa/cerrar')`, operación
 * `cerrarFichaOperativa`, cuerpo vacío). Efectos del backend:
 *  - fija `fichaCerrada = true`, `fechaCierre = now()`,
 *  - transiciona `pre_evento_status: en_curso → cerrado`,
 *  - NUNCA falla por campos vacíos (D-6): devuelve `avisosCamposVacios` como aviso
 *    puramente informativo (nunca un 4xx bloqueante).
 *
 * Tras éxito escribe la `FichaOperativa` cerrada en la caché de la query de la ficha
 * (el consumidor conserva por separado el `avisosCamposVacios` para el aviso).
 */
export const useCerrarFicha = () => {
  const queryClient = useQueryClient();

  return useMutation<CerrarFichaOperativaResponse, Error, CerrarFichaVars>({
    mutationFn: async ({ reservaId }) => {
      const { data, response } = await apiClient.POST(
        '/reservas/{id}/ficha-operativa/cerrar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw new Error(
        `No se ha podido cerrar la ficha operativa (${response?.status ?? 'red'})`,
      );
    },
    onSuccess: (respuesta, { reservaId }) => {
      // La respuesta de cierre extiende `FichaOperativa` con `avisosCamposVacios`;
      // ese aviso lo consume el componente por separado, la caché solo guarda la ficha.
      queryClient.setQueryData(fichaOperativaQueryKey(reservaId), {
        tipo: 'disponible',
        ficha: respuesta,
      });
      void queryClient.invalidateQueries({ queryKey: fichaOperativaQueryKey(reservaId) });
    },
  });
};
