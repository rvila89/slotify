import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type ExtenderBloqueoRequest = components['schemas']['ExtenderBloqueoRequest'];
type ExtenderBloqueoConflictoError = components['schemas']['ExtenderBloqueoConflictoError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables del override "Extender bloqueo" (US-006 · UC-05): N días enteros ≥ 1. */
export type ExtenderBloqueoVars = {
  id: string;
  body: ExtenderBloqueoRequest;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type ExtenderBloqueoError =
  | {
      /**
       * 409 ExtenderBloqueoConflictoError: conflicto con el estado del bloqueo en BD
       * (TTL ya expirado, bloqueo firme, o sin fila bloqueante blanda vigente).
       */
      tipo: 'conflicto';
      motivo: string;
    }
  | {
      /** 422: estado sin bloqueo extensible (guarda) o `dias` inválido (0/negativo/no entero). */
      tipo: 'validacion';
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
 * Mutación del override manual "Extender bloqueo" (US-006 · UC-05). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/extender-bloqueo')`, body `{ dias }`) y
 * normaliza cada desenlace:
 *  - 200: RESERVA con el nuevo `ttlExpiracion` (= TTL anterior + N días);
 *    `estado`/`subEstado`/`tipoBloqueo`/`fecha` sin cambios.
 *  - 409 `ExtenderBloqueoConflictoError`: el bloqueo no es extensible por su estado
 *    en BD (expirado / firme / sin fila bloqueante blanda); se expone su `motivo`.
 *  - 422: estado sin bloqueo activo extensible (guarda `2a`/terminal) o `dias`
 *    inválido (0/negativo/no entero) — el mensaje del servidor manda.
 *
 * Tras éxito actualiza/invalida la query de la reserva para refrescar su TTL.
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useExtenderBloqueo = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, ExtenderBloqueoError, ExtenderBloqueoVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/extender-bloqueo', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as ExtenderBloqueoConflictoError | undefined;
        const motivo =
          conflicto?.motivo ??
          primerMensaje(conflicto) ??
          'El bloqueo ha expirado o ya no es extensible. No se ha modificado la consulta.';
        throw { tipo: 'conflicto', motivo } satisfies ExtenderBloqueoError;
      }

      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'No se puede extender el bloqueo con los datos indicados.';
        throw { tipo: 'validacion', mensaje } satisfies ExtenderBloqueoError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido extender el bloqueo. Inténtalo de nuevo.',
      } satisfies ExtenderBloqueoError;
    },
    onSuccess: (reserva, { id }) => {
      // Actualiza la cache con la RESERVA devuelta (nuevo TTL) y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
