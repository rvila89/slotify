import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorPresupuesto } from './normalizarError';
import type {
  PresupuestoError,
  PresupuestoPreviewResponse,
  PreviewPresupuestoRequest,
} from '../model/types';

/** Variables del preview del presupuesto (US-014 · UC-14): borrador editable. */
export type PreviewPresupuestoVars = {
  id: string;
  body: PreviewPresupuestoRequest;
};

/**
 * Mutación del **borrador** del presupuesto (US-014 · UC-14). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/presupuesto/preview')`): calcula el
 * desglose delegando al motor de tarifa (US-016) y **NO persiste** nada (no crea
 * PRESUPUESTO, no muta la RESERVA ni la FechaBloqueada, no envía email). Se usa al
 * abrir el diálogo y cada vez que el gestor ajusta extras / precio manual para
 * recalcular el borrador antes de confirmar.
 *
 * Desenlaces (normalizados a `PresupuestoError` en español):
 *  - 200: `PresupuestoPreviewResponse` con `tarifaAConsultar`, `tarifa`,
 *    `desglose` (null si tarifa a consultar sin precio), `reparto` y `extrasTotalEur`.
 *  - 422 DATOS_FISCALES_INCOMPLETOS (FA-01) → `datos-fiscales` con `camposFaltantes`.
 *  - 422 TARIFA_NO_CONFIGURADA / TEMPORADA_NO_CONFIGURADA → `tarifa-no-configurada`.
 *  - 409 ORIGEN_INVALIDO / PRESUPUESTO_YA_EXISTE → guarda de origen (remite a UC-15).
 *
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const usePreviewPresupuesto = () =>
  useMutation<PresupuestoPreviewResponse, PresupuestoError, PreviewPresupuestoVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/presupuesto/preview',
        {
          params: { path: { id } },
          body,
        },
      );

      if (data) return data;

      throw normalizarErrorPresupuesto(response?.status, error);
    },
  });
