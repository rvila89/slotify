import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorEdicion } from './normalizarErrorEdicion';
import type {
  EdicionPresupuestoPreviewRequest,
  EdicionPresupuestoPreviewResponse,
  PresupuestoError,
} from '../model/types';

/** Variables del preview de la edición del presupuesto (US-015 · UC-15). */
export type PreviewEdicionVars = {
  id: string;
  body: EdicionPresupuestoPreviewRequest;
};

/**
 * Mutación del **preview de edición** del presupuesto (US-015 · UC-15). Consume el
 * SDK generado (`apiClient.POST('/reservas/{id}/presupuesto/edicion/preview')`):
 * recalcula el borrador con los cambios propuestos (nº invitados, duración, líneas
 * de extras con precio congelado por el server, descuento) delegando en el motor de
 * tarifa (US-016) y **NO persiste** nada (no crea versión de PRESUPUESTO, no
 * crea/modifica `RESERVA_EXTRA`, no muta `RESERVA.estado`/`ttlExpiracion`, no envía
 * email). Se usa al abrir el diálogo de edición y en vivo ante cada cambio.
 *
 * Desenlaces (normalizados a `PresupuestoError` en español, `normalizarErrorEdicion`):
 *  - 200: `EdicionPresupuestoPreviewResponse` con `tarifaAConsultar`, `desglose`
 *    (null si tarifa a consultar sin precio), `lineasExtras` congeladas y `reparto`.
 *  - 409 ORIGEN_INVALIDO → `edicion-no-permitida` (fuera de pre_reserva / aceptado).
 *  - 422 DESCUENTO_INVALIDO / DURACION_INVALIDA / DATOS_FISCALES / tarifa.
 *
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const usePreviewEdicionPresupuesto = () =>
  useMutation<EdicionPresupuestoPreviewResponse, PresupuestoError, PreviewEdicionVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/presupuesto/edicion/preview',
        { params: { path: { id } }, body },
      );

      if (data) return data;

      throw normalizarErrorEdicion(response?.status, error);
    },
  });
