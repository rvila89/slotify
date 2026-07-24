import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorFactura } from './normalizarError';
import { facturaSenalQueryKey } from './useFacturaSenal';
import { facturaLiquidacionQueryKey } from './useFacturaLiquidacion';
import type { FacturaError, FacturaSenal } from '../model/types';

/** Variables del reintento de generación del PDF de la factura de señal (US-022). */
export type RegenerarPdfVars = {
  /** ID de la FACTURA. */
  id: string;
  /** ID de la RESERVA, para localizar la query cacheada de su factura. */
  reservaId: string;
};

/**
 * Mutación de **reintento manual del PDF** de la factura de señal (US-022 · UC-18).
 * Consume el SDK generado (`apiClient.POST('/facturas/{id}/regenerar-pdf')`, operación
 * `regenerarPdfFactura`, cuerpo vacío; idempotente sobre `pdfUrl`). Efecto en éxito:
 * `pdfUrl` actualizado, `pdfPendiente=false`, sin cambio de estado (`borrador`).
 *
 * Desenlaces (normalizados a `FacturaError` en español):
 *  - 200: `FacturaSenalDto` con `pdfUrl` disponible.
 *  - 409 FACTURA_NO_BORRADOR → PDF de una factura emitida es inmutable.
 *  - 422 DATOS_FISCALES_INCOMPLETOS → borrador inválido (con `camposFaltantes`).
 *  - 422 PDF_PENDIENTE → el servicio de PDF sigue fallando; reintentar más tarde.
 *
 * Tras éxito actualiza/invalida la query de la factura de señal de la reserva.
 */
export const useRegenerarPdf = () => {
  const queryClient = useQueryClient();

  return useMutation<FacturaSenal, FacturaError, RegenerarPdfVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST('/facturas/{id}/regenerar-pdf', {
        params: { path: { id } },
        body: {},
      });
      if (data) return data;
      throw normalizarErrorFactura(response?.status, error);
    },
    onSuccess: (factura, { reservaId }) => {
      queryClient.setQueryData(facturaSenalQueryKey(reservaId), factura);
      void queryClient.invalidateQueries({ queryKey: facturaSenalQueryKey(reservaId) });
      // La liquidación comparte el endpoint de regeneración de PDF; refresca también su query.
      void queryClient.invalidateQueries({ queryKey: facturaLiquidacionQueryKey(reservaId) });
    },
  });
};
