import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { normalizarErrorDevolverFianza } from './normalizarErrorDevolverFianza';
import type { DevolucionFianzaError, DevolverFianzaResponse } from '../model/types';

/** Variables de la devolución de fianza (devolución completa; cuerpo vacío). */
export type DevolverFianzaVars = {
  reservaId: string;
};

/**
 * Mutación de **devolución de la fianza** (fix-liquidacion-fianza-independientes: devolución
 * completa por el importe `fianzaEur`, sin IBAN ni retención). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/fianza/devolver')`, operación `devolverFianza`, cuerpo
 * vacío). En una transacción atómica marca `fianzaStatus='devuelta'` y `fianzaDevueltaFecha`;
 * el email E10 de confirmación se dispara post-commit best-effort (un fallo NO revierte la
 * devolución y llega en `avisoEmail`, reintentable desde la ficha). No se edita el cliente
 * generado a mano.
 *
 * Desenlaces (normalizados a `DevolucionFianzaError` en español):
 *  - 200: `DevolverFianzaResponse` (RESERVA `devuelta` + `avisoEmail` nulo o con fallo E10).
 *  - 409 PRECONDICION_NO_CUMPLIDA / DEVOLUCION_YA_REGISTRADA.
 *  - 400/401/403/404/red → genérico.
 *
 * Tras éxito actualiza/invalida la query de la reserva y las comunicaciones (E10).
 */
export const useDevolverFianza = () => {
  const queryClient = useQueryClient();

  return useMutation<DevolverFianzaResponse, DevolucionFianzaError, DevolverFianzaVars>({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/fianza/devolver',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorDevolverFianza(response?.status, error);
    },
    onSuccess: ({ reserva }, { reservaId }) => {
      queryClient.setQueryData(reservaQueryKey(reservaId), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
  });
};
