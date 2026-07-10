import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';
import { reservasActivasQueryKey } from './useReservasActivas';
import { MENSAJE_FIANZA_NO_RESUELTA } from '../lib/archivarReserva';

type Reserva = components['schemas']['Reserva'];
type FinalizarEventoConflictError = components['schemas']['FinalizarEventoConflictError'];
type ArchivarFianzaNoResueltaError = components['schemas']['ArchivarFianzaNoResueltaError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Archivar reserva" (US-038 · UC-28 flujo manual). */
export type ArchivarReservaVars = {
  id: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type ArchivarReservaError =
  | {
      /**
       * 409 `transicion_no_permitida`: la RESERVA ya no está en `post_evento`
       * (estado distinto, ya `reserva_completada` por un pase del cron de US-037, u
       * otra acción / doble clic — design.md §D-6). Sin efectos: no se ha modificado.
       */
      tipo: 'conflicto';
      mensaje: string;
    }
  | {
      /**
       * 422 `fianza_no_resuelta`: la RESERVA está en `post_evento` pero la fianza no
       * está resuelta (`fianzaStatus ∈ {cobrada, recibo_enviado, pendiente}` con
       * `fianzaEur > 0`). Precondición de negocio incumplida (FA-01/FA-02). Sin efectos.
       */
      tipo: 'fianza_no_resuelta';
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
 * Mutación de la acción "Archivar reserva" (US-038 · UC-28 flujo alternativo
 * manual). Consume el SDK generado (`apiClient.POST('/reservas/{id}/archivar')`,
 * operación `archivarReservaManual`, body vacío) y normaliza cada desenlace:
 *  - 200 `Reserva`: RESERVA en `estado='reserva_completada'` (terminal). Sale del
 *    pipeline activo (US-049 excluye `reserva_completada`) y pasa al Histórico.
 *  - 422 `fianza_no_resuelta`: la fianza no está resuelta (FA-01/FA-02) →
 *    `fianza_no_resuelta` con el mensaje específico; la RESERVA no se muta.
 *  - 409 `transicion_no_permitida`: la RESERVA ya no está en `post_evento` (carrera
 *    con el cron de US-037 / doble clic) → `conflicto`, sin mutar la RESERVA.
 *  - 401/403/404/red: `generico`.
 *
 * El código HTTP distingue la precondición de negocio (422 fianza) del conflicto de
 * estado del agregado (409), como fija design.md §D-3=3.B, para que la UI muestre
 * dos mensajes diferenciados. Tras éxito actualiza/invalida la query de la reserva
 * (nuevo estado terminal) y del pipeline activo (para que la reserva desaparezca).
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useArchivarReserva = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, ArchivarReservaError, ArchivarReservaVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/archivar', {
        params: { path: { id } },
        // Cuerpo vacío (Record<string, never>): la única entrada es el path y el
        // Gestor autenticado (JWT). Se envía `{}` para satisfacer el tipo generado.
        body: {},
      });

      if (data) return data;

      const status = response?.status;

      if (status === 422) {
        const fianza = error as ArchivarFianzaNoResueltaError | undefined;
        const mensaje = primerMensaje(fianza) ?? MENSAJE_FIANZA_NO_RESUELTA;
        throw { tipo: 'fianza_no_resuelta', mensaje } satisfies ArchivarReservaError;
      }

      if (status === 409) {
        const conflicto = error as FinalizarEventoConflictError | undefined;
        const mensaje =
          primerMensaje(conflicto) ??
          'La reserva ya no está en post-evento, así que no se puede archivar. Puede que ya se haya archivado.';
        throw { tipo: 'conflicto', mensaje } satisfies ArchivarReservaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido archivar la reserva. Inténtalo de nuevo.',
      } satisfies ArchivarReservaError;
    },
    onSuccess: (respuesta, { id }) => {
      // Mergea el estado `reserva_completada` en la cache de la reserva y refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...respuesta } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // La reserva sale del pipeline activo: invalida el listado de activas.
      void queryClient.invalidateQueries({ queryKey: reservasActivasQueryKey });
    },
  });
};
