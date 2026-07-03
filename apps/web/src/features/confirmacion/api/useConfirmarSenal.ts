import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorConfirmarSenal } from './normalizarError';
import type { ConfirmarSenalError, ConfirmarSenalResponse } from '../model/types';

/** Variables de la confirmación del pago de la señal (US-021 · UC-17). */
export type ConfirmarSenalVars = {
  id: string;
  /** Fichero justificante del pago (JPEG/PNG/PDF, ≤ 10 MB). */
  justificante: File;
};

/**
 * Mutación de **confirmación del pago de la señal** (US-021 · UC-17). Consume el
 * SDK generado (`apiClient.POST('/reservas/{id}/confirmar-senal')`, operación
 * `confirmarSenal`) enviando el fichero por `multipart/form-data` (campo
 * `justificante`). En una única transacción del backend: crea el DOCUMENTO
 * (`tipo='justificante_pago'`), eleva la RESERVA a `reserva_confirmada`
 * (`ttlExpiracion=null`), promueve el bloqueo de fecha a firme, congela
 * `importeSenal`/`importeLiquidacion` e inicializa los tres sub-procesos en
 * `pendiente`; tras el commit puede devolver la factura de señal en borrador.
 *
 * El body multipart se construye con `FormData` y se pasa con un `bodySerializer`
 * identidad para que `openapi-fetch` NO lo serialice a JSON y el navegador fije el
 * `Content-Type: multipart/form-data` con su boundary. No se edita el cliente
 * generado a mano (regla dura del proyecto).
 *
 * Desenlaces (normalizados a `ConfirmarSenalError` en español):
 *  - 200: `ConfirmarSenalResponse` (RESERVA confirmada + DOCUMENTO justificante +
 *    `facturaSenalBorrador?`).
 *  - 422 ORIGEN_INVALIDO → "La reserva no está en estado pre_reserva".
 *  - 422 JUSTIFICANTE_REQUERIDO / FORMATO_NO_PERMITIDO / TAMANO_EXCEDIDO /
 *    IMPORTE_TOTAL_INVALIDO → mensaje específico.
 *  - 409 RESERVA_YA_CONFIRMADA → "La reserva ya ha sido confirmada" (doble clic).
 *  - 409 FECHA_NO_DISPONIBLE → "Fecha no disponible" (carrera D4).
 *
 * Tras éxito actualiza/invalida la query de la reserva (nuevo estado
 * `reserva_confirmada`, importes y sub-procesos).
 */
export const useConfirmarSenal = () => {
  const queryClient = useQueryClient();

  return useMutation<ConfirmarSenalResponse, ConfirmarSenalError, ConfirmarSenalVars>({
    mutationFn: async ({ id, justificante }) => {
      const formData = new FormData();
      formData.append('justificante', justificante);

      const { data, error, response } = await apiClient.POST('/reservas/{id}/confirmar-senal', {
        params: { path: { id } },
        // El tipo generado espera `{ justificante: string }`; en runtime enviamos
        // el binario vía FormData. El serializer identidad evita el JSON.stringify.
        body: formData as unknown as { justificante: string },
        bodySerializer: (body) => body as unknown as BodyInit,
      });

      if (data) return data;

      throw normalizarErrorConfirmarSenal(response?.status, error);
    },
    onSuccess: ({ reserva }, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
