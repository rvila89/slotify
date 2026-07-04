import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorFactura } from './normalizarError';
import { facturaSenalQueryKey } from './useFacturaSenal';
import type { FacturaError, FacturaSenal } from '../model/types';

/** Variables del rechazo del borrador de la factura de señal (US-022). */
export type RechazarFacturaVars = {
  /** ID de la FACTURA. */
  id: string;
  /** ID de la RESERVA, para localizar la query cacheada de su factura. */
  reservaId: string;
  /** Motivo del rechazo (obligatorio, no vacío). Se registra en `AUDIT_LOG`. */
  motivo: string;
};

/**
 * Mutación de **rechazo** del borrador de la factura de señal (US-022 · UC-18).
 * Consume el SDK generado (`apiClient.POST('/facturas/{id}/rechazar')`, operación
 * `rechazarFactura`, cuerpo `{ motivo }`). La FACTURA **permanece en `borrador`** (el
 * rechazo no cambia el estado); el motivo queda en `AUDIT_LOG` y E3 sigue bloqueado.
 * El Gestor puede resolver la incidencia (p. ej. corregir datos del tenant) y
 * regenerar el PDF para volver a revisar.
 *
 * Desenlaces (normalizados a `FacturaError` en español):
 *  - 200: `FacturaSenalDto`, aún en `borrador`.
 *  - 400: motivo requerido / inválido.
 *  - 409 FACTURA_NO_BORRADOR → "La factura no está en borrador".
 */
export const useRechazarFactura = () => {
  const queryClient = useQueryClient();

  return useMutation<FacturaSenal, FacturaError, RechazarFacturaVars>({
    mutationFn: async ({ id, motivo }) => {
      const { data, error, response } = await apiClient.POST('/facturas/{id}/rechazar', {
        params: { path: { id } },
        body: { motivo },
      });
      if (data) return data;
      throw normalizarErrorFactura(response?.status, error);
    },
    onSuccess: (factura, { reservaId }) => {
      queryClient.setQueryData(facturaSenalQueryKey(reservaId), factura);
      void queryClient.invalidateQueries({ queryKey: facturaSenalQueryKey(reservaId) });
    },
  });
};
