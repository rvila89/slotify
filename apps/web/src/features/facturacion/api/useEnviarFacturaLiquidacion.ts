import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { normalizarErrorLiquidacion } from './normalizarErrorLiquidacion';
import { facturaLiquidacionQueryKey } from './useFacturaLiquidacion';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { EnviarFacturaLiquidacionResponse, LiquidacionError } from '../model/types';

/** Variables del envío de la factura de liquidación (E4, standalone). */
export type EnviarFacturaLiquidacionVars = {
  /** ID de la RESERVA (path del endpoint y clave de las queries cacheadas). */
  reservaId: string;
};

/**
 * Mutación de **emisión + envío de la factura de liquidación** (E4, standalone, espejo del
 * envío de la factura de señal tras fix-liquidacion-fianza-independientes). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/facturas/liquidacion/enviar')`, operación
 * `enviarFacturaLiquidacion`, cuerpo vacío). Emite la liquidación (asigna `numeroFactura`,
 * `fechaEmision`, `estado='enviada'`, `liquidacionStatus='facturada'`) **solo si E4 se
 * confirma** (atomicidad estado↔E4, rollback total). No toca la fianza. No se edita el
 * cliente generado a mano.
 *
 * Desenlaces (normalizados a `LiquidacionError` en español, contexto `enviar`):
 *  - 200: `EnviarFacturaLiquidacionResponse` (liquidación emitida + `liquidacionStatus`).
 *  - 404 `FACTURA_LIQUIDACION_NO_ENCONTRADA` → no existe factura de liquidación.
 *  - 409 `FACTURA_NO_BORRADOR` → ya emitida.
 *  - 502/503 `EMISION_ENVIO_FALLIDO` → fallo recuperable, reintentable (rollback total).
 *
 * Tras éxito invalida la factura de liquidación, la colección de facturas y las
 * comunicaciones de la reserva para reflejar la emisión y el E4 registrado.
 */
export const useEnviarFacturaLiquidacion = () => {
  const queryClient = useQueryClient();

  return useMutation<
    EnviarFacturaLiquidacionResponse,
    LiquidacionError,
    EnviarFacturaLiquidacionVars
  >({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/liquidacion/enviar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorLiquidacion(response?.status, error, 'enviar');
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: facturaLiquidacionQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: facturasReservaQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
  });
};
