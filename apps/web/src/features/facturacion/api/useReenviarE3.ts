import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { normalizarErrorReenvioE3 } from './normalizarErrorReenvioE3';
import { facturaSenalQueryKey } from './useFacturaSenal';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { ReenviarE3Response, ReenvioE3Error } from '../model/types';

/** Variables del reenvío de E3 (factura de señal + condiciones particulares ya emitidas). */
export type ReenviarE3Vars = {
  /** ID de la RESERVA (path del endpoint y clave de las queries de facturas cacheadas). */
  reservaId: string;
};

/**
 * Mutación de **reenvío de E3** (US-023 · GAP 3 · design.md §D-reenvio-e3), espejo de
 * `useReenviarLiquidacion` (E4). Es la acción del Gestor que vuelve a remitir al cliente la factura
 * de señal ya emitida junto con las condiciones particulares. Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/facturas/senal/reenviar')`, operación `reenviarE3`, cuerpo
 * vacío). Reutiliza los documentos ya emitidos: **NO** reasigna número, **NO** cambia el estado de
 * la factura ni transiciona la reserva; crea una **nueva** COMUNICACION E3 (`esReenvio=true`) y
 * actualiza `condPartEnviadasFecha`. No se edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `ReenvioE3Error` en español):
 *  - 200: `ReenviarE3Response` (factura sin cambios + nueva COMUNICACION de reenvío + fecha).
 *  - 404 `FACTURA_SENAL_NO_ENCONTRADA` → no existe factura de señal.
 *  - 409 `E3_NO_ENVIADO_PREVIAMENTE` → no hay un E3 previo que reenviar.
 *  - 409 `CONDICIONES_NO_CONFIGURADAS` → el tenant no tiene condiciones configuradas (GAP 2).
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO` → fallo recuperable, reintentable (rollback total).
 *
 * Tras éxito invalida la factura de señal y la colección de facturas de la reserva para reflejar la
 * nueva fecha de envío de E3 y la traza del reenvío.
 */
export const useReenviarE3 = () => {
  const queryClient = useQueryClient();

  return useMutation<ReenviarE3Response, ReenvioE3Error, ReenviarE3Vars>({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/senal/reenviar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorReenvioE3(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: facturaSenalQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: facturasReservaQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
  });
};
