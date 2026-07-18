import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type UpdateReservaRequest = components['schemas']['UpdateReservaRequest'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Variables del PATCH de campos simples de la RESERVA (US-051 §Punto 2 · §D-1).
 * NUNCA incluye `fechaEvento`: la fecha se muta solo por el flujo atómico
 * (`POST /reservas/{id}/fecha` o `/cambiar-fecha`), nunca por este PATCH.
 */
export type EditarConsultaVars = {
  id: string;
  body: UpdateReservaRequest;
};

/** Error normalizado del PATCH, para que la UI ramifique en español. */
export type EditarConsultaError =
  | {
      /** 400/422: validación (p. ej. `horario` sin `duracionHoras`). */
      tipo: 'validacion';
      mensaje: string;
      /** Campo del formulario al que asociar el error, si el servidor lo indica. */
      campo?: keyof UpdateReservaRequest;
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
 * Mutación de edición de campos simples de la RESERVA (US-051 · UC — edición de
 * datos). Consume el SDK generado (`apiClient.PATCH('/reservas/{id}')`) y no toca
 * la fecha. Tras éxito actualiza e invalida la query de la reserva.
 */
export const useEditarConsulta = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, EditarConsultaError, EditarConsultaVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.PATCH('/reservas/{id}', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;
      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'Los datos indicados no son válidos para esta consulta.';
        // Heurística: si el mensaje del servidor menciona el horario, se asocia
        // al campo `horario` (validación cruzada con `duracionHoras`, §D-1).
        const campo = /horario/i.test(mensaje) ? ('horario' as const) : undefined;
        throw { tipo: 'validacion', mensaje, campo } satisfies EditarConsultaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se han podido guardar los cambios. Inténtalo de nuevo.',
      } satisfies EditarConsultaError;
    },
    onSuccess: (reserva, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
