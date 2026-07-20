import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type AsignarFechaRequest = components['schemas']['AsignarFechaRequest'];
type AsignarFechaConflictoError = components['schemas']['AsignarFechaConflictoError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Variables de la transición 2.a → 2.b/2.d (US-005 · UC-04).
 * `aceptarCola` resuelve el flujo interactivo de cola sin estado servidor: la
 * 1ª llamada (sin/false) informa con 409; la 2ª con `true` confirma la entrada.
 */
export type AsignarFechaVars = {
  id: string;
  body: AsignarFechaRequest;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique. */
export type AsignarFechaError =
  | {
      /** 409 colaDisponible=true: bloqueada por una consulta en 2b (o carrera D4). */
      tipo: 'cola-disponible';
      motivo: string;
    }
  | {
      /** 409 colaDisponible=false: bloqueada por 2c/2v/pre_reserva/confirmada+. */
      tipo: 'no-disponible';
      motivo: string;
    }
  | {
      /** 400/422: fecha no válida o RESERVA no en 2a (guarda de origen). */
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
 * Mutación de la transición de fecha. Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/fecha')`) y normaliza cada desenlace:
 *  - 200 `subEstado='2b'`: fecha bloqueada provisionalmente (+ email al cliente).
 *  - 200 `subEstado='2d'`: entrada en cola con `posicionCola`.
 *  - 409 `colaDisponible=true`: ofrecer entrar en cola (reintentar con `aceptarCola=true`).
 *  - 409 `colaDisponible=false`: no disponible, sin cola.
 *  - 400/422: validación (fecha inválida / estado no válido).
 *
 * Tras éxito invalida la query de la reserva para refrescar su estado.
 */
export const useAsignarFecha = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, AsignarFechaError, AsignarFechaVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/fecha', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as AsignarFechaConflictoError | undefined;
        const motivo =
          conflicto?.motivo ??
          primerMensaje(conflicto) ??
          'La fecha no está disponible.';
        throw conflicto?.colaDisponible
          ? ({ tipo: 'cola-disponible', motivo } satisfies AsignarFechaError)
          : ({ tipo: 'no-disponible', motivo } satisfies AsignarFechaError);
      }

      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'La fecha indicada no es válida para esta consulta.';
        throw { tipo: 'validacion', mensaje } satisfies AsignarFechaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido asignar la fecha. Inténtalo de nuevo.',
      } satisfies AsignarFechaError;
    },
    onSuccess: (reserva, { id }) => {
      // Actualiza la cache con la RESERVA devuelta y la marca para refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // La transición de fecha crea el borrador E1 (US-047): invalidar la lectura de
      // comunicaciones para que el borrador recién creado aparezca sin recargar (§D-4).
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(id) });
    },
  });
};
