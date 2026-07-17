import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorEnviarBorrador } from './normalizarError';
import { comunicacionesReservaQueryKey } from './useComunicacionesReserva';
import type { Comunicacion, EnviarBorradorError } from '../model/types';

/** Variables del envío (con edición opcional) de un borrador (US-046 · UC-36). */
export type EnviarBorradorVars = {
  reservaId: string;
  idComunicacion: string;
  /** Asunto editado por el gestor; si se omite, el backend usa el original del borrador. */
  asunto?: string;
  /** Cuerpo editado por el gestor; si se omite, el backend usa el original del borrador. */
  cuerpo?: string;
};

/**
 * Mutación de "revisar y enviar borrador" (US-046 · UC-36). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/comunicaciones/{idComunicacion}/enviar')`, operación
 * `enviarBorradorComunicacion`) con `asunto`/`cuerpo` editados opcionales. No se edita
 * el cliente generado a mano.
 *
 * Desenlaces (normalizados a `EnviarBorradorError` en español):
 *  - 200 `Comunicacion`: borrador → `enviado` con `fechaEnvio` y el `asunto`/`cuerpo`
 *    efectivamente enviado (no la versión original).
 *  - 422 `DESTINATARIO_INVALIDO` → `destinatario`: no se intentó; queda en `borrador`.
 *  - 409 `ESTADO_NO_BORRADOR` → `conflicto`: la fila ya no es `borrador`; refrescar.
 *  - 502 `PROVEEDOR_EMAIL_FALLIDO` → `proveedor`: la fila quedó `fallido`; reintentable.
 *
 * Tras éxito invalida el listado de comunicaciones de la reserva para reflejar el nuevo
 * estado. En el 409 y el 502 también invalida (el estado de servidor cambió).
 */
export const useEnviarBorrador = () => {
  const queryClient = useQueryClient();

  return useMutation<Comunicacion, EnviarBorradorError, EnviarBorradorVars>({
    mutationFn: async ({ reservaId, idComunicacion, asunto, cuerpo }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/comunicaciones/{idComunicacion}/enviar',
        {
          params: { path: { id: reservaId, idComunicacion } },
          body: { ...(asunto !== undefined ? { asunto } : {}), ...(cuerpo !== undefined ? { cuerpo } : {}) },
        },
      );
      if (data) return data;
      throw normalizarErrorEnviarBorrador(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
    onError: (err, { reservaId }) => {
      // Conflicto de estado o fila persistida en `fallido` (proveedor): el servidor
      // cambió; refrescar para que la lista refleje el estado real.
      if (err.tipo === 'conflicto' || err.tipo === 'proveedor') {
        void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
      }
    },
  });
};
