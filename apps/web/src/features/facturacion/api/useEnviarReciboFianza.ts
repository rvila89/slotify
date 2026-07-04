import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorLiquidacion } from './normalizarErrorLiquidacion';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { EnviarReciboFianzaResponse, LiquidacionError } from '../model/types';

/** Variables del envío separado del recibo de fianza (US-028 · D-3). */
export type EnviarReciboFianzaVars = {
  /** ID de la RESERVA (path del endpoint y clave de la query cacheada de sus facturas). */
  reservaId: string;
};

/**
 * Mutación de **envío separado del recibo de fianza** (US-028 · design.md §D-3). Consume
 * el SDK generado (`apiClient.POST('/reservas/{id}/facturas/fianza/enviar')`, operación
 * `enviarReciboFianza`, cuerpo vacío). Edge case sin liquidación: emite el recibo de fianza
 * (`estado='enviada'`, `numeroFactura` propio) y avanza `fianzaStatus='recibo_enviado'`;
 * **NO** cambia `liquidacionStatus`. Se registra como email `manual` (no E4). Un posterior
 * "Aprobar y enviar" de la liquidación ya no re-emitirá la fianza (E4 adjunta solo la
 * liquidación).
 *
 * Desenlaces (normalizados a `LiquidacionError` en español):
 *  - 200: `EnviarReciboFianzaResponse` (fianza emitida + `fianzaStatus`).
 *  - 409 `FACTURA_NO_BORRADOR` → el recibo ya no está en borrador (ya enviado).
 *  - 422 `DATOS_FISCALES_INCOMPLETOS` / `PDF_PENDIENTE`.
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO` → fallo recuperable, rollback total, reintentable.
 *
 * Tras éxito invalida la colección de facturas de la reserva. No se edita el SDK a mano.
 */
export const useEnviarReciboFianza = () => {
  const queryClient = useQueryClient();

  return useMutation<EnviarReciboFianzaResponse, LiquidacionError, EnviarReciboFianzaVars>({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/fianza/enviar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorLiquidacion(response?.status, error, 'enviar-fianza');
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({
        queryKey: facturasReservaQueryKey(reservaId),
      });
    },
  });
};
