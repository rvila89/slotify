import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type ResultadoVisitaRequest = components['schemas']['ResultadoVisitaRequest'];
type ResultadoVisita = components['schemas']['ResultadoVisita'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Variables de la transición "Registrar resultado de visita" (US-009 · UC-08). En
 * esta US solo `resultado='interesado'` (2.v → 2.b) está operativo; el tipo del SDK
 * incluye `reserva_inmediata`/`descarta` (US-010/US-011) para dejar la estructura
 * preparada, pero el servidor los rechaza con 422 hasta que se implementen.
 */
export type RegistrarResultadoVisitaVars = {
  id: string;
  resultado: ResultadoVisita;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type RegistrarResultadoVisitaError =
  | {
      /**
       * 422: guarda de origen (la RESERVA no está en `2v`) o resultado no soportado
       * (`reserva_inmediata`/`descarta`, US-010/US-011). La RESERVA no se modifica.
       */
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
 * Mutación de la transición "Registrar resultado de visita → cliente interesado"
 * (US-009 · UC-08). Consume el SDK generado
 * (`apiClient.PATCH('/reservas/{id}/visita')`, body `{ resultado }`) y normaliza
 * cada desenlace:
 *  - 200: RESERVA actualizada (`subEstado='2b'`, `visitaRealizada=true` y el nuevo
 *    `ttlExpiracion` fresco = `now + TENANT_SETTINGS.ttl_consulta_dias`).
 *  - 404: la RESERVA no existe → genérico.
 *  - 422: guarda de origen (no está en `2v` / terminal, inmutable) o resultado no
 *    soportado (`reserva_inmediata`/`descarta`, US-010/US-011) — el mensaje del
 *    servidor manda.
 *
 * Tras éxito actualiza/invalida la query de la reserva para refrescar su estado y
 * TTL. No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useRegistrarResultadoVisita = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, RegistrarResultadoVisitaError, RegistrarResultadoVisitaVars>({
    mutationFn: async ({ id, resultado }) => {
      const body: ResultadoVisitaRequest = { resultado };
      const { data, error, response } = await apiClient.PATCH('/reservas/{id}/visita', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;

      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'No se puede registrar este resultado de visita para la consulta en su estado actual.';
        throw { tipo: 'validacion', mensaje } satisfies RegistrarResultadoVisitaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido registrar el resultado de la visita. Inténtalo de nuevo.',
      } satisfies RegistrarResultadoVisitaError;
    },
    onSuccess: (reserva, { id }) => {
      // Actualiza la cache con la RESERVA devuelta (2b + TTL fresco) y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
