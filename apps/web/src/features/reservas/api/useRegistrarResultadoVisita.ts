import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import type { CampoObligatorio } from '../lib/datosObligatorios';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type ResultadoVisitaRequest = components['schemas']['ResultadoVisitaRequest'];
type ResultadoVisita = components['schemas']['ResultadoVisita'];
type ErrorResponse = components['schemas']['ErrorResponse'];
type DatosIncompletosError = components['schemas']['PresupuestoDatosFiscalesError'];

/**
 * Variables de la transición "Registrar resultado de visita" (UC-08/UC-14 ·
 * US-009/US-010). Operativos en el frontend:
 *  - `interesado` (US-009): 2.v → 2.b con TTL fresco de consulta y email E7.
 *  - `reserva_inmediata` (US-010): 2.v → pre_reserva con TTL de 7 días, vaciado de
 *    cola A16 y validación de datos obligatorios UC-14 (sin email).
 * `descarta` (US-011) sigue rechazado con 422 por el servidor.
 */
export type RegistrarResultadoVisitaVars = {
  id: string;
  resultado: ResultadoVisita;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type RegistrarResultadoVisitaError =
  | {
      /**
       * 422 `DATOS_FISCALES_INCOMPLETOS` (solo `reserva_inmediata`, US-010 · UC-14
       * FA-01): faltan datos obligatorios de RESERVA/CLIENTE. La RESERVA permanece
       * intacta en `2v`; el cuerpo enumera los campos que faltan.
       */
      tipo: 'datos-incompletos';
      camposFaltantes: CampoObligatorio[];
      mensaje: string;
    }
  | {
      /**
       * 422: guarda de origen (la RESERVA no está en `2v`) o resultado no soportado
       * (`descarta`, US-011). La RESERVA no se modifica.
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
 * Mutación de la transición "Registrar resultado de visita" (UC-08/UC-14 ·
 * US-009/US-010). Consume el SDK generado
 * (`apiClient.PATCH('/reservas/{id}/visita')`, body `{ resultado }`) y normaliza
 * cada desenlace:
 *  - 200 `interesado`: RESERVA en `subEstado='2b'`, `visitaRealizada=true`, TTL
 *    fresco de consulta.
 *  - 200 `reserva_inmediata`: RESERVA en `estado='pre_reserva'`, `subEstado=null`,
 *    `visitaRealizada=true`, `ttlExpiracion = now + ttl_prereserva_dias` (7 días).
 *  - 422 `DATOS_FISCALES_INCOMPLETOS`: faltan datos obligatorios UC-14 →
 *    `datos-incompletos` con `camposFaltantes` (solo `reserva_inmediata`).
 *  - 422 otro: guarda de origen / resultado no soportado → `validacion`.
 *  - 404 / red: `generico`.
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
        const cuerpo = error as (DatosIncompletosError & { codigo?: string }) | undefined;

        if (cuerpo?.codigo === 'DATOS_FISCALES_INCOMPLETOS') {
          throw {
            tipo: 'datos-incompletos',
            camposFaltantes: cuerpo.camposFaltantes ?? [],
            mensaje:
              primerMensaje(cuerpo) ??
              'Faltan datos obligatorios de la reserva o del cliente para poder reservar en el acto.',
          } satisfies RegistrarResultadoVisitaError;
        }

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
      // Actualiza la cache con la RESERVA devuelta (2b o pre_reserva) y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
