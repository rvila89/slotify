import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorFactura } from './normalizarError';
import { facturaSenalQueryKey } from './useFacturaSenal';
import type { FacturaError, FacturaSenal } from '../model/types';

/** Variables de la aprobación del borrador de la factura de señal (US-022). */
export type AprobarFacturaVars = {
  /** ID de la FACTURA. */
  id: string;
  /** ID de la RESERVA, para localizar la query cacheada de su factura. */
  reservaId: string;
};

/**
 * Mutación de **aprobación** del borrador de la factura de señal (US-022 · UC-18).
 * Consume el SDK generado (`apiClient.POST('/facturas/{id}/aprobar')`, operación
 * `aprobarFactura`, cuerpo vacío). Efecto: `estado → 'enviada'`, asigna
 * `numeroFactura` y fija `fechaEmision`; deja la factura lista para adjuntarse en E3.
 *
 * Desenlaces (normalizados a `FacturaError` en español):
 *  - 200: `FacturaSenalDto` con `estado='enviada'`.
 *  - 409 FACTURA_NO_BORRADOR → "La factura no está en borrador" (doble aprobación).
 *  - 422 DATOS_FISCALES_INCOMPLETOS → borrador inválido (con `camposFaltantes`).
 *  - 422 PDF_PENDIENTE → PDF pendiente de regenerar.
 *
 * Tras éxito actualiza/invalida la query de la factura de señal de la reserva.
 */
export const useAprobarFactura = () => {
  const queryClient = useQueryClient();

  return useMutation<FacturaSenal, FacturaError, AprobarFacturaVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST('/facturas/{id}/aprobar', {
        params: { path: { id } },
        body: {},
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
