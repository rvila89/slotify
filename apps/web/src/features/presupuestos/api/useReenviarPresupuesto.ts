import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorEdicion } from './normalizarErrorEdicion';
import type { PresupuestoError, ReenviarPresupuestoResponse } from '../model/types';

/** Variables del reenvío sin cambios del presupuesto vigente (US-015 · UC-15). */
export type ReenviarPresupuestoVars = {
  id: string;
};

/**
 * Mutación de **reenvío sin cambios** del presupuesto vigente (US-015 · UC-15).
 * Consume el SDK generado (`apiClient.POST('/reservas/{id}/presupuesto/reenvio')`):
 * NO crea una versión nueva ni consume número — reenvía el PDF de la versión vigente
 * (`MAX(version)`), registra una `COMUNICACION` E2 (`esReenvio=true`, `estado=enviado`)
 * + AUDIT_LOG y deja la versión en `estado='enviado'`. No toca `RESERVA.estado`
 * (sigue `pre_reserva`) ni el bloqueo de fecha.
 *
 * Desenlaces (normalizados a `PresupuestoError`, `normalizarErrorEdicion`):
 *  - 200: `ReenviarPresupuestoResponse` (presupuesto vigente + COMUNICACION E2).
 *  - 409 ORIGEN_INVALIDO → `edicion-no-permitida` (fuera de pre_reserva / aceptado /
 *    sin versión vigente que reenviar).
 *
 * Tras éxito invalida la query de la reserva. No se edita el cliente generado a mano.
 */
export const useReenviarPresupuesto = () => {
  const queryClient = useQueryClient();

  return useMutation<ReenviarPresupuestoResponse, PresupuestoError, ReenviarPresupuestoVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/presupuesto/reenvio',
        { params: { path: { id } }, body: {} },
      );

      if (data) return data;

      throw normalizarErrorEdicion(response?.status, error);
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
