import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { ChecklistDocumentacionEvento } from '../model/types';

/**
 * Clave de query del checklist de documentación del evento de una reserva. Se
 * exporta para que la mutación de subida (US-033) pueda actualizar/invalidar
 * exactamente esta entrada tras un 201.
 */
export const checklistDocumentacionEventoQueryKey = (id: string) =>
  ['documentacion-evento', 'checklist', id] as const;

/**
 * Estado de servidor del checklist de documentación obligatoria del evento
 * (US-033 · UC-24, N2): TanStack Query sobre el SDK generado
 * (`apiClient.GET('/reservas/{id}/documentos-evento/checklist')`, única vía a la
 * API). Devuelve los tres ítems (`dni_anverso`, `dni_reverso`,
 * `clausula_responsabilidad`) con su estado `completado` y el documento más
 * reciente de referencia. No se edita el cliente generado a mano.
 */
export const useChecklistDocumentacionEvento = (id: string | undefined) =>
  useQuery({
    queryKey: checklistDocumentacionEventoQueryKey(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<ChecklistDocumentacionEvento> => {
      const { data, error, response } = await apiClient.GET(
        '/reservas/{id}/documentos-evento/checklist',
        { params: { path: { id: id as string } } },
      );
      if (error || !data) {
        throw new Error(
          `No se ha podido cargar el checklist de documentación (${response?.status ?? 'red'})`,
        );
      }
      return data;
    },
  });
