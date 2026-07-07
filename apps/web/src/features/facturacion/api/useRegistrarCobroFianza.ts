import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorCobroFianza } from './normalizarErrorCobroFianza';
import { facturasReservaQueryKey } from './useFacturasReserva';
import { reservaQueryKey } from '@/features/reservas';
import type { CobroFianzaError, RegistrarCobroFianzaResponse } from '../model/types';

/** Variables del registro del cobro de fianza (US-030 · UC-22). */
export type RegistrarCobroFianzaVars = {
  /** ID de la RESERVA (path del endpoint y clave de las queries cacheadas). */
  reservaId: string;
  /** Importe REAL cobrado como `Importe` (string decimal, p. ej. "1000.00"); DEBE ser > 0. */
  importe: string;
  /** Fecha del cobro (DATE `YYYY-MM-DD`); DEBE ser ≤ `fechaEvento`. */
  fechaCobro: string;
  /** OPCIONAL: id de un DOCUMENTO `justificante_pago` ya subido; sin él el cobro es válido. */
  justificanteDocId?: string;
  /**
   * Política "Negociable" (design.md §D-2): sobre `fianzaStatus='pendiente'`, `false`/ausente
   * → respuesta `confirmacion_requerida` (NO crea PAGO); `true` → el Gestor confirma el cobro
   * sin recibo enviado y se registra igualmente.
   */
  confirmarSinRecibo?: boolean;
};

/**
 * Mutación de **registro del cobro de fianza** (US-030 · UC-22). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/facturas/fianza/cobro')`, operación `registrarCobroFianza`).
 * En una única transacción atómica el backend crea el `PAGO`, transiciona la
 * `FACTURA(fianza).estado='cobrada'` y `RESERVA.fianzaStatus='cobrada'`, y registra
 * `fianzaEur`/`fianzaCobradaFecha`. La guarda de doble cobro (`SELECT ... FOR UPDATE`) rechaza
 * un segundo intento con 409.
 *
 * Desenlaces:
 *  - 200 `resultado='cobrado'` → el cobro se registró (data del PAGO + fianza cobrada).
 *  - 200 `resultado='confirmacion_requerida'` (política Negociable, `fianzaStatus='pendiente'`
 *    sin `confirmarSinRecibo`) → NO crea PAGO; el diálogo muestra el aviso y reintenta con
 *    `confirmarSinRecibo: true`. **No es un error**: se devuelve como data.
 *  - 409 `FIANZA_YA_COBRADA` → doble cobro (normalizado a `CobroFianzaError`).
 *  - 400 `COBRO_INVALIDO` / 404 `FACTURA_FIANZA_NO_ENCONTRADA` / `JUSTIFICANTE_NO_ENCONTRADO`.
 *
 * Tras un cobro efectivo invalida la colección de facturas y la reserva (para reflejar el
 * estado `cobrada`, `fianzaEur` y `fianzaCobradaFecha`). No se edita el cliente generado a mano.
 */
export const useRegistrarCobroFianza = () => {
  const queryClient = useQueryClient();

  return useMutation<RegistrarCobroFianzaResponse, CobroFianzaError, RegistrarCobroFianzaVars>({
    mutationFn: async ({ reservaId, importe, fechaCobro, justificanteDocId, confirmarSinRecibo }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/fianza/cobro',
        {
          params: { path: { id: reservaId } },
          body: {
            importe,
            fechaCobro,
            confirmarSinRecibo: confirmarSinRecibo ?? false,
            ...(justificanteDocId ? { justificanteDocId } : {}),
          },
        },
      );
      if (data) return data;
      throw normalizarErrorCobroFianza(response?.status, error);
    },
    onSuccess: (data, { reservaId }) => {
      // Solo el cobro efectivo cambia el estado del servidor; el aviso Negociable no.
      if (data.resultado !== 'cobrado') return;
      void queryClient.invalidateQueries({ queryKey: facturasReservaQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(reservaId) });
    },
  });
};
