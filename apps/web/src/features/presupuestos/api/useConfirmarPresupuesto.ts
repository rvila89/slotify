import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { normalizarErrorPresupuesto } from './normalizarError';
import type {
  ConfirmarPresupuestoRequest,
  ConfirmarPresupuestoResponse,
  PresupuestoError,
} from '../model/types';

/** Variables de la confirmación del presupuesto (US-014 · UC-14). */
export type ConfirmarPresupuestoVars = {
  id: string;
  body: ConfirmarPresupuestoRequest;
};

/**
 * Mutación de **confirmación** del presupuesto (US-014 · UC-14). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/presupuesto')`): en una única
 * transacción crea el PRESUPUESTO congelado (`estado='enviado'`, IVA 21%),
 * transiciona la RESERVA a `pre_reserva` (TTL = 7 d), hace insert-o-update del
 * bloqueo, vacía la cola A16 y, post-commit, dispara el email E2 con el PDF.
 *
 * Desenlaces (normalizados a `PresupuestoError` en español):
 *  - 201: `ConfirmarPresupuestoResponse` (PRESUPUESTO + RESERVA en `pre_reserva`
 *    + `reparto` + `consultasDescartadas`).
 *  - 409 FECHA_NO_DISPONIBLE (carrera D4) → `fecha-no-disponible`.
 *  - 409 PRESUPUESTO_YA_EXISTE → `presupuesto-ya-existe` (remite a UC-15).
 *  - 409 ORIGEN_INVALIDO / doble clic → `origen-invalido`.
 *  - 422 DATOS_FISCALES_INCOMPLETOS (FA-01) → `datos-fiscales`.
 *  - 422 PRECIO_MANUAL_REQUERIDO (FA-02) → `precio-manual-requerido`.
 *  - 422 TARIFA_NO_CONFIGURADA / TEMPORADA_NO_CONFIGURADA → `tarifa-no-configurada`.
 *
 * Tras éxito actualiza/invalida la query de la reserva (nuevo estado `pre_reserva`
 * y TTL). No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useConfirmarPresupuesto = () => {
  const queryClient = useQueryClient();

  return useMutation<ConfirmarPresupuestoResponse, PresupuestoError, ConfirmarPresupuestoVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/presupuesto', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      throw normalizarErrorPresupuesto(response?.status, error);
    },
    onSuccess: ({ reserva }, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // El presupuesto dispara el email E2 (post-commit): refresca también el
      // listado de comunicaciones para que la nueva entrada aparezca sin recargar.
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(id) });
    },
  });
};
