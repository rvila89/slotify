import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type ProgramarVisitaRequest = components['schemas']['ProgramarVisitaRequest'];
type ProgramarVisitaConflictoError = components['schemas']['ProgramarVisitaConflictoError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la transición 2.a/2.b/2.c → 2.v (US-008 · UC-07): fecha y hora de la visita. */
export type ProgramarVisitaVars = {
  id: string;
  body: ProgramarVisitaRequest;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type ProgramarVisitaError =
  | {
      /** 409 ProgramarVisitaConflictoError: RESERVA en cola (2d); debe promoverse primero (UC-12). */
      tipo: 'cola';
      motivo: string;
    }
  | {
      /** 422: guarda de origen / 2a sin fechaEvento / fecha fuera de ventana. */
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
 * Mutación de la transición "Programar visita" (US-008 · UC-07). Consume el SDK
 * generado (`apiClient.POST('/reservas/{id}/visita')`, body `{ fecha, hora }`) y
 * normaliza cada desenlace:
 *  - 200: RESERVA pasa a `subEstado='2v'` con `visitaProgramadaFecha/Hora`,
 *    `visitaRealizada=false` y el `ttlExpiracion` extendido a la fecha de visita +1 día.
 *  - 409 `ProgramarVisitaConflictoError`: la RESERVA está en cola (`2d`); se expone su
 *    `motivo` (promover primero, UC-12).
 *  - 422: guarda de origen (no en `2a/2b/2c`, o terminal), `2a` sin `fechaEvento`, o
 *    fecha fuera de la ventana `[hoy+1, hoy+max_dias_programar_visita]`.
 *
 * Tras éxito actualiza/invalida la query de la reserva para refrescar su estado.
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useProgramarVisita = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, ProgramarVisitaError, ProgramarVisitaVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/visita', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as ProgramarVisitaConflictoError | undefined;
        const motivo =
          conflicto?.motivo ??
          primerMensaje(conflicto) ??
          'No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12).';
        throw { tipo: 'cola', motivo } satisfies ProgramarVisitaError;
      }

      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'No se puede programar la visita con los datos indicados.';
        throw { tipo: 'validacion', mensaje } satisfies ProgramarVisitaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido programar la visita. Inténtalo de nuevo.',
      } satisfies ProgramarVisitaError;
    },
    onSuccess: (reserva, { id }) => {
      // Actualiza la cache con la RESERVA devuelta y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
