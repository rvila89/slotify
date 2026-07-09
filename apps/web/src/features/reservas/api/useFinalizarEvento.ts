import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];
type FinalizarEventoConflictError = components['schemas']['FinalizarEventoConflictError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Marcar evento como finalizado" (US-034 · UC-25). */
export type FinalizarEventoVars = {
  id: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type FinalizarEventoError =
  | {
      /**
       * 409 `transicion_no_permitida`: la RESERVA no está en `evento_en_curso`
       * (estado distinto, o carrera de doble finalización perdida — D-8). Sin
       * efectos: la RESERVA no se ha modificado.
       */
      tipo: 'conflicto';
      mensaje: string;
    }
  | {
      /** 401/403/404/red u otros: error genérico. */
      tipo: 'generico';
      mensaje: string;
    };

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/**
 * Mutación de la acción "Marcar evento como finalizado" (US-034 · UC-25). Consume el
 * SDK generado (`apiClient.POST('/reservas/{id}/finalizar-evento')`, operación
 * `finalizarEvento`, body vacío) y normaliza cada desenlace:
 *  - 200 `FinalizarEventoResponse`: RESERVA en `estado='post_evento'` +
 *    `e5: { resultado: enviado|fallido|no_aplica, comunicacionId? }` +
 *    `documentacionPendiente: string[]` (advertencia informativa no bloqueante).
 *  - 409 `transicion_no_permitida`: la RESERVA no está en `evento_en_curso` →
 *    `conflicto` (doble finalización / estado distinto), sin mutar la RESERVA.
 *  - 401/403/404/red: `generico`.
 *
 * La transición a `post_evento` y el envío de E5 son operaciones separadas en el
 * backend (design.md §D-2): un 200 con `e5.resultado='fallido'` NO es un error de la
 * mutación — la RESERVA sí avanzó a `post_evento` y la UI muestra la alerta de
 * reenvío diferido. Tras éxito actualiza/invalida la query de la reserva para
 * refrescar su estado (`post_evento`). No se edita el cliente generado a mano (regla
 * dura del proyecto).
 */
export const useFinalizarEvento = () => {
  const queryClient = useQueryClient();

  return useMutation<FinalizarEventoResponse, FinalizarEventoError, FinalizarEventoVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/finalizar-evento', {
        params: { path: { id } },
        // El cuerpo es vacío (Record<string, never>): la única entrada es el path y
        // el Gestor autenticado (JWT). Se envía `{}` para satisfacer el tipo generado.
        body: {},
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as FinalizarEventoConflictError | undefined;
        const mensaje =
          primerMensaje(conflicto) ??
          'La reserva no está en curso, así que no se puede finalizar el evento. Puede que ya se haya finalizado.';
        throw { tipo: 'conflicto', mensaje } satisfies FinalizarEventoError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido finalizar el evento. Inténtalo de nuevo.',
      } satisfies FinalizarEventoError;
    },
    onSuccess: (respuesta, { id }) => {
      // La respuesta extiende `Reserva` (misma forma que `ReservaDetalle` en sus
      // campos comunes): mergea el estado `post_evento` en la cache y refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...respuesta } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
