import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorCondicionesFirmadas } from './normalizarError';
import type {
  CondicionesFirmadasError,
  RegistrarCondicionesFirmadasResponse,
} from '../model/types';

/** Variables del registro de la firma de condiciones particulares (US-024 · UC-19). */
export type RegistrarCondicionesFirmadasVars = {
  id: string;
  /** Copia firmada de las condiciones (JPEG/PNG/PDF, ≤ 10 MB). */
  condicionesFirmadas: File;
};

/**
 * Mutación de **registro de la firma de condiciones particulares** (US-024 · UC-19,
 * segundo flujo). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/condiciones-firmadas')`, operación
 * `registrarCondicionesFirmadas`) enviando la copia firmada por
 * `multipart/form-data` (campo `condicionesFirmadas`). En una única transacción del
 * backend: crea el DOCUMENTO (`tipo='condiciones_particulares'`), marca
 * `condPartFirmadas=true` y fija `condPartFechaFirma`. NO transiciona el estado de
 * la reserva (D-no-transicion). La re-firma es válida (D-re-firma): cada registro
 * crea una versión nueva y actualiza la fecha.
 *
 * El body multipart se construye con `FormData` y se pasa con un `bodySerializer`
 * identidad para que `openapi-fetch` NO lo serialice a JSON y el navegador fije el
 * `Content-Type: multipart/form-data` con su boundary. No se edita el cliente
 * generado a mano (regla dura del proyecto).
 *
 * Desenlaces (normalizados a `CondicionesFirmadasError` en español):
 *  - 200: `RegistrarCondicionesFirmadasResponse` (RESERVA con `condPartFirmadas=true`
 *    + `condPartFechaFirma` + DOCUMENTO firmado).
 *  - 409 CONDICIONES_NO_ENVIADAS → "Las condiciones particulares no han sido enviadas…".
 *  - 422 ESTADO_INVALIDO / CONDICIONES_REQUERIDAS / FORMATO_NO_PERMITIDO / TAMANO_EXCEDIDO.
 *  - 400/401/403/404/red → genérico.
 *
 * Tras éxito actualiza/invalida la query de la reserva (nuevo `condPartFirmadas` +
 * `condPartFechaFirma`).
 */
export const useRegistrarCondicionesFirmadas = () => {
  const queryClient = useQueryClient();

  return useMutation<
    RegistrarCondicionesFirmadasResponse,
    CondicionesFirmadasError,
    RegistrarCondicionesFirmadasVars
  >({
    mutationFn: async ({ id, condicionesFirmadas }) => {
      const formData = new FormData();
      formData.append('condicionesFirmadas', condicionesFirmadas);

      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/condiciones-firmadas',
        {
          params: { path: { id } },
          // El tipo generado espera `{ condicionesFirmadas: string }`; en runtime
          // enviamos el binario vía FormData. El serializer identidad evita el
          // JSON.stringify y deja que el navegador fije el boundary multipart.
          body: formData as unknown as { condicionesFirmadas: string },
          bodySerializer: (body) => body as unknown as BodyInit,
        },
      );

      if (data) return data;

      throw normalizarErrorCondicionesFirmadas(response?.status, error);
    },
    onSuccess: ({ reserva }, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
