import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { checklistDocumentacionEventoQueryKey } from './useChecklistDocumentacionEvento';
import { normalizarErrorSubirDocumento } from './normalizarError';
import type {
  SubirDocumentoEventoError,
  SubirDocumentoEventoResponse,
  TipoDocumentoEvento,
} from '../model/types';

/** Variables de la subida de un documento del evento (US-033 · UC-24). */
export type SubirDocumentoEventoVars = {
  id: string;
  /** Tipo del documento obligatorio (`dni_anverso` | `dni_reverso` | `clausula_responsabilidad`). */
  tipo: TipoDocumentoEvento;
  /** Fichero del documento (JPEG/PNG/PDF, ≤ 10 MB). */
  archivo: File;
};

/**
 * Mutación de **subida de un documento obligatorio del evento** (US-033 · UC-24,
 * N1). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/documentos-evento')`, operación
 * `subirDocumentoEvento`) enviando el fichero por `multipart/form-data` (campos
 * `archivo` binario + `tipo`). En una única transacción atómica del backend: sube
 * los bytes al almacén durable, crea una fila DOCUMENTO nueva (no idempotente:
 * conserva histórico, N3) y audita (`AUDIT_LOG accion='crear'`). La RESERVA y sus
 * sub-procesos no cambian.
 *
 * El body multipart se construye con `FormData` y se pasa con un `bodySerializer`
 * identidad para que `openapi-fetch` NO lo serialice a JSON y el navegador fije el
 * `Content-Type: multipart/form-data` con su boundary (mismo patrón vivo que
 * `useConfirmarSenal` de US-021). No se edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `SubirDocumentoEventoError` en español):
 *  - 201: `SubirDocumentoEventoResponse` (DOCUMENTO creado + checklist actualizado).
 *  - 422 ESTADO_NO_PERMITE_DOCUMENTACION / TIPO_DOCUMENTO_NO_PERMITIDO /
 *    ARCHIVO_REQUERIDO / FORMATO_NO_PERMITIDO / ARCHIVO_INVALIDO / TAMANO_EXCEDIDO.
 *  - 404 → reserva inexistente / de otro tenant.
 *
 * Tras el 201 refresca el checklist en tiempo real usando el `checklist` de la
 * respuesta (sin round-trip) y además invalida la query para reconciliar.
 */
export const useSubirDocumentoEvento = () => {
  const queryClient = useQueryClient();

  return useMutation<SubirDocumentoEventoResponse, SubirDocumentoEventoError, SubirDocumentoEventoVars>({
    mutationFn: async ({ id, tipo, archivo }) => {
      const formData = new FormData();
      formData.append('archivo', archivo);
      formData.append('tipo', tipo);

      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/documentos-evento',
        {
          params: { path: { id } },
          // El tipo generado espera `{ archivo: string; tipo }`; en runtime enviamos
          // el binario vía FormData. El serializer identidad evita el JSON.stringify.
          body: formData as unknown as { archivo: string; tipo: TipoDocumentoEvento },
          bodySerializer: (body) => body as unknown as BodyInit,
        },
      );

      if (data) return data;

      throw normalizarErrorSubirDocumento(response?.status, error);
    },
    onSuccess: ({ checklist }, { id }) => {
      // Refresco en tiempo real con el checklist de la respuesta 201 (N1), evitando
      // un round-trip; luego se invalida para reconciliar con el servidor.
      queryClient.setQueryData(checklistDocumentacionEventoQueryKey(id), checklist);
      void queryClient.invalidateQueries({
        queryKey: checklistDocumentacionEventoQueryKey(id),
      });
    },
  });
};
