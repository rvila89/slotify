import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorLiquidacion } from './normalizarErrorLiquidacion';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { LiquidacionError, ReenviarLiquidacionResponse } from '../model/types';

/** Variables del reenvío de la factura de liquidación ya emitida (US-028 · D-4). */
export type ReenviarLiquidacionVars = {
  /** ID de la RESERVA (path del endpoint y clave de la query cacheada de sus facturas). */
  reservaId: string;
};

/**
 * Mutación de **reenvío** de la factura de liquidación ya emitida (US-028 · design.md §D-4).
 * Consume el SDK generado (`apiClient.POST('/reservas/{id}/facturas/liquidacion/reenviar')`,
 * operación `reenviarLiquidacion`, cuerpo vacío). Reenvía al cliente el PDF **ya emitido**:
 * **NO** reasigna `numeroFactura`, **NO** cambia `FACTURA.estado` ni los status de la RESERVA;
 * solo crea una **nueva** `COMUNICACION` E4 de reenvío (traza auditada).
 *
 * Desenlaces (normalizados a `LiquidacionError` en español):
 *  - 200: `ReenviarLiquidacionResponse` (liquidación sin cambios + comunicación de reenvío).
 *  - 409 → la liquidación aún NO está `enviada` (nada que reenviar) → `no-enviada`.
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO` → fallo recuperable, reintentable.
 *
 * Tras éxito invalida la colección de facturas de la reserva (la factura no cambia, pero se
 * refresca por consistencia). No se edita el cliente generado a mano.
 */
export const useReenviarLiquidacion = () => {
  const queryClient = useQueryClient();

  return useMutation<ReenviarLiquidacionResponse, LiquidacionError, ReenviarLiquidacionVars>({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/liquidacion/reenviar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorLiquidacion(response?.status, error, 'reenviar');
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({
        queryKey: facturasReservaQueryKey(reservaId),
      });
    },
  });
};
