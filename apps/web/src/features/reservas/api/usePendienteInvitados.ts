import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type PendienteInvitadosResponse = components['schemas']['PendienteInvitadosResponse'];
type BloqueoNoVigenteError = components['schemas']['BloqueoNoVigenteError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la transición 2.b → 2.c (US-007 · UC-06). Body vacío: el TTL se deriva del setting del tenant. */
export type PendienteInvitadosVars = {
  id: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type PendienteInvitadosError =
  | {
      /** 409 BloqueoNoVigenteError: sin fila activa en FechaBloqueada o ttl_expiracion < ahora. */
      tipo: 'bloqueo-no-vigente';
      motivo: string;
    }
  | {
      /** 422: guarda de origen no satisfecha (la RESERVA no está en 2b). */
      tipo: 'guarda-origen';
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
 * Mutación de la transición "Marcar como pendiente de invitados" (US-007 · UC-06).
 * Consume el SDK generado (`apiClient.POST('/reservas/{id}/pendiente-invitados')`,
 * body `{}`) y normaliza cada desenlace:
 *  - 200: RESERVA pasa a `subEstado='2c'` con `ttlExpiracion` extendido y
 *    `consultasDescartadas` (recuento de la cola vaciada A16, 0 si no había cola).
 *  - 409 `BloqueoNoVigenteError`: el bloqueo no está vigente (sin fecha bloqueada
 *    activa o TTL expirado); se expone su `motivo`.
 *  - 422: la RESERVA no está en `2b` (guarda de origen).
 *
 * Tras éxito actualiza/invalida la query de la reserva para refrescar su estado.
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const usePendienteInvitados = () => {
  const queryClient = useQueryClient();

  return useMutation<PendienteInvitadosResponse, PendienteInvitadosError, PendienteInvitadosVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/pendiente-invitados',
        {
          params: { path: { id } },
          body: {},
        },
      );

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as BloqueoNoVigenteError | undefined;
        const motivo =
          conflicto?.motivo ??
          primerMensaje(conflicto) ??
          'El bloqueo de la fecha ya no está vigente.';
        throw { tipo: 'bloqueo-no-vigente', motivo } satisfies PendienteInvitadosError;
      }

      if (status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'Esta consulta ya no está en un estado que permita marcarla como pendiente de invitados.';
        throw { tipo: 'guarda-origen', mensaje } satisfies PendienteInvitadosError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido completar la acción. Inténtalo de nuevo.',
      } satisfies PendienteInvitadosError;
    },
    onSuccess: ({ reserva }, { id }) => {
      // Actualiza la cache con la RESERVA devuelta y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
