import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorComprobanteFianza } from './normalizarErrorComprobanteFianza';
import type { ComprobanteFianzaError, SubirComprobanteFianzaResponse } from '../model/types';

/** Variables de la subida del comprobante de fianza (fix-liquidacion-fianza-independientes). */
export type SubirComprobanteFianzaVars = {
  reservaId: string;
  /** Comprobante de la transferencia recibida (JPEG/PNG/PDF, ≤ 10 MB). */
  comprobanteFianza: File;
};

/**
 * Mutación de **subida del comprobante de la transferencia de fianza** (fianza pasiva, espejo
 * de `useRegistrarCondicionesFirmadas`). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/fianza/comprobante')`, operación `subirComprobanteFianza`)
 * enviando el fichero por `multipart/form-data` (campo `comprobanteFianza`). En una única
 * transacción del backend: crea el DOCUMENTO (`tipo='comprobante_fianza'`), marca
 * `fianzaStatus='cobrada'`, fija `fianzaCobradaFecha` y `fianzaComprobanteFecha`. NO
 * transiciona el estado ni bloquea ninguna transición; es opcional y re-subible.
 *
 * El body multipart se construye con `FormData` y se pasa con un `bodySerializer` identidad
 * para que `openapi-fetch` NO lo serialice a JSON y el navegador fije el
 * `Content-Type: multipart/form-data` con su boundary. No se edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `ComprobanteFianzaError` en español):
 *  - 200: `SubirComprobanteFianzaResponse` (RESERVA con `fianzaStatus='cobrada'` + DOCUMENTO).
 *  - 422 ESTADO_INVALIDO / COMPROBANTE_REQUERIDO / FORMATO_NO_PERMITIDO / TAMANO_EXCEDIDO.
 *  - 400/401/403/404/red → genérico.
 *
 * Tras éxito actualiza/invalida la query de la reserva (nuevo `fianzaStatus` + fechas).
 */
export const useSubirComprobanteFianza = () => {
  const queryClient = useQueryClient();

  return useMutation<
    SubirComprobanteFianzaResponse,
    ComprobanteFianzaError,
    SubirComprobanteFianzaVars
  >({
    mutationFn: async ({ reservaId, comprobanteFianza }) => {
      const formData = new FormData();
      formData.append('comprobanteFianza', comprobanteFianza);

      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/fianza/comprobante',
        {
          params: { path: { id: reservaId } },
          // El tipo generado espera `{ comprobanteFianza: string }`; en runtime enviamos el
          // binario vía FormData. El serializer identidad evita el JSON.stringify y deja que
          // el navegador fije el boundary multipart.
          body: formData as unknown as { comprobanteFianza: string },
          bodySerializer: (body) => body as unknown as BodyInit,
        },
      );

      if (data) return data;
      throw normalizarErrorComprobanteFianza(response?.status, error);
    },
    onSuccess: ({ reserva }, { reservaId }) => {
      queryClient.setQueryData(reservaQueryKey(reservaId), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(reservaId) });
    },
  });
};
