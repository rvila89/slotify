import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorLiquidacion } from './normalizarErrorLiquidacion';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type {
  AprobarEnviarLiquidacionResponse,
  LiquidacionError,
} from '../model/types';

/**
 * Variables de "Aprobar y enviar" la factura de liquidación (US-028 · UC-21). El
 * `descuento`/`motivo` son OPCIONALES (ajuste negociado, design.md §D-2); si se omiten,
 * la liquidación se emite con el total del borrador.
 */
export type AprobarEnviarLiquidacionVars = {
  /** ID de la RESERVA (path del endpoint y clave de la query cacheada de sus facturas). */
  reservaId: string;
  /** Descuento a restar del total, `Importe` (string decimal, p. ej. "200.00"). */
  descuento?: string;
  /** Motivo opcional del descuento; se registra en `AUDIT_LOG`. */
  motivo?: string;
};

/**
 * Mutación de **aprobación + envío atómico** de la factura de liquidación (US-028 · UC-21).
 * Consume el SDK generado (`apiClient.POST('/reservas/{id}/facturas/liquidacion/aprobar-enviar')`,
 * operación `aprobarEnviarLiquidacion`). En una única acción atómica estado↔email (design.md
 * §D-1) el backend emite la liquidación (`estado='enviada'`, `numeroFactura='F-YYYY-NNNN'`,
 * `fechaEmision`), avanza `liquidacionStatus='facturada'`, emite la fianza si seguía en
 * borrador (`fianzaStatus='recibo_enviado'`) y envía el email E4 con ambos PDFs.
 *
 * Desenlaces (normalizados a `LiquidacionError` en español):
 *  - 200: `AprobarEnviarLiquidacionResponse` (liquidación emitida + fianza + status).
 *  - 409 `FACTURA_NO_BORRADOR` → la liquidación ya no está en borrador (usa "Reenviar").
 *  - 422 `DATOS_FISCALES_INCOMPLETOS` / `PDF_PENDIENTE` / `DESCUENTO_INVALIDO`.
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO` → fallo recuperable, rollback total, reintentable.
 *
 * Tras éxito invalida la colección de facturas de la reserva para reflejar `numeroFactura`,
 * `estado='enviada'` y los status actualizados. No se edita el cliente generado a mano.
 */
export const useAprobarEnviarLiquidacion = () => {
  const queryClient = useQueryClient();

  return useMutation<
    AprobarEnviarLiquidacionResponse,
    LiquidacionError,
    AprobarEnviarLiquidacionVars
  >({
    mutationFn: async ({ reservaId, descuento, motivo }) => {
      const body: { descuento?: string; motivo?: string } = {};
      if (descuento) body.descuento = descuento;
      if (motivo) body.motivo = motivo;

      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/liquidacion/aprobar-enviar',
        { params: { path: { id: reservaId } }, body },
      );
      if (data) return data;
      throw normalizarErrorLiquidacion(response?.status, error, 'aprobar-enviar');
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({
        queryKey: facturasReservaQueryKey(reservaId),
      });
    },
  });
};
