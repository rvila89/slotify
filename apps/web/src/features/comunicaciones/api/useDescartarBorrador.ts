import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorDescartar } from './normalizarError';
import { comunicacionesReservaQueryKey } from './useComunicacionesReserva';
import type { Comunicacion, DescartarBorradorError } from '../model/types';

/** Variables del descarte de un borrador (US-046 · UC-36). */
export type DescartarBorradorVars = {
  reservaId: string;
  idComunicacion: string;
};

/**
 * Mutación de "descartar borrador" (US-046 · UC-36). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/comunicaciones/{idComunicacion}/descartar')`,
 * operación `descartarBorradorComunicacion`, sin cuerpo). El descarte NO envía email:
 * el borrador pasa a `fallido` (no hay estado "descartado" en el enum) con `AUDIT_LOG`
 * de causa "descartado por gestor" — desaparece de la bandeja de pendientes. No se
 * edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `DescartarBorradorError` en español):
 *  - 200 `Comunicacion`: borrador → `fallido` sin `fechaEnvio`.
 *  - 409 `ESTADO_NO_BORRADOR` → `conflicto`: la fila ya no es `borrador`; refrescar.
 *
 * Tras éxito (y en el 409, porque el estado de servidor cambió) invalida el listado.
 */
export const useDescartarBorrador = () => {
  const queryClient = useQueryClient();

  return useMutation<Comunicacion, DescartarBorradorError, DescartarBorradorVars>({
    mutationFn: async ({ reservaId, idComunicacion }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/comunicaciones/{idComunicacion}/descartar',
        { params: { path: { id: reservaId, idComunicacion } } },
      );
      if (data) return data;
      throw normalizarErrorDescartar(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
    onError: (err, { reservaId }) => {
      if (err.tipo === 'conflicto') {
        void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
      }
    },
  });
};
