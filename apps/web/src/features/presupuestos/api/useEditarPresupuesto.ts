import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorEdicion } from './normalizarErrorEdicion';
import type {
  EdicionPresupuestoRequest,
  EdicionPresupuestoResponse,
  PresupuestoError,
} from '../model/types';

/** Variables de la confirmación de la edición del presupuesto (US-015 · UC-15). */
export type EditarPresupuestoVars = {
  id: string;
  body: EdicionPresupuestoRequest;
};

/**
 * Mutación de **confirmación de la edición** del presupuesto (US-015 · UC-15).
 * Consume el SDK generado (`apiClient.POST('/reservas/{id}/presupuesto/edicion')`):
 * en una transacción crea un PRESUPUESTO nuevo (`version = anterior + 1`,
 * `tarifaCongelada=true`), persiste las líneas `RESERVA_EXTRA` con `precioUnitario`
 * congelado y, según `enviar`:
 *  - `enviar=true` → `estado='enviado'`, consume `numeroPresupuesto` (AAAANNN),
 *    regenera el PDF y dispara el email E2 (`COMUNICACION` `esReenvio=true`) + AUDIT_LOG.
 *  - `enviar=false` → `estado='borrador'`, `numeroPresupuesto=null`, sin email.
 * La RESERVA permanece en `pre_reserva` y `FECHA_BLOQUEADA.ttlExpiracion` NO cambia.
 *
 * Desenlaces (normalizados a `PresupuestoError`, `normalizarErrorEdicion`):
 *  - 201: `EdicionPresupuestoResponse` (nueva versión + reserva en `pre_reserva`).
 *  - 409 ORIGEN_INVALIDO → `edicion-no-permitida`.
 *  - 422 DESCUENTO_INVALIDO / DURACION_INVALIDA / PRECIO_MANUAL_REQUERIDO / datos fiscales.
 *
 * Tras éxito actualiza/invalida la query de la reserva. No se edita el cliente
 * generado a mano (regla dura del proyecto).
 */
export const useEditarPresupuesto = () => {
  const queryClient = useQueryClient();

  return useMutation<EdicionPresupuestoResponse, PresupuestoError, EditarPresupuestoVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/presupuesto/edicion',
        { params: { path: { id } }, body },
      );

      if (data) return data;

      throw normalizarErrorEdicion(response?.status, error);
    },
    onSuccess: ({ reserva }, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
