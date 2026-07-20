import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { comunicacionesReservaQueryKey } from '@/features/comunicaciones';
import { reservaQueryKey } from './useReserva';

type Reserva = components['schemas']['Reserva'];
type CambiarFechaRequest = components['schemas']['CambiarFechaRequest'];
type CambiarFechaConflictoError = components['schemas']['CambiarFechaConflictoError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Variables del cambio ATÓMICO de una fecha ya bloqueada (US-051 §D-2.1).
 * Aplica a RESERVAS en `2b`/`2c`/`2v` (fecha ya bloqueada). El servidor libera la
 * antigua y bloquea la nueva en UNA transacción; a diferencia del alta/asignación
 * NO ofrece cola para la fecha nueva (el conflicto es terminal).
 */
export type CambiarFechaVars = {
  id: string;
  body: CambiarFechaRequest;
};

/** Error normalizado del cambio de fecha, para que la UI ramifique en español. */
export type CambiarFechaError =
  | {
      /** 409: la fecha destino está ocupada por otra RESERVA (rollback total, sin cola). */
      tipo: 'no-disponible';
      motivo: string;
    }
  | {
      /** 422: guarda no satisfecha (sub-estado sin fecha bloqueada, o fecha no futura). */
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
 * Mutación del cambio atómico de fecha (US-051 §D-2.1). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/cambiar-fecha')`) y normaliza cada desenlace:
 *  - 200: RESERVA con la nueva `fechaEvento` (estado/sub-estado conservados).
 *  - 409 `CambiarFechaConflictoError`: fecha destino no disponible (con `motivo`).
 *  - 422: guarda inválida (sub-estado o fecha no futura).
 *
 * Tras éxito actualiza e invalida la query de la reserva.
 */
export const useCambiarFecha = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, CambiarFechaError, CambiarFechaVars>({
    mutationFn: async ({ id, body }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/cambiar-fecha', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as CambiarFechaConflictoError | undefined;
        const motivo =
          conflicto?.motivo ??
          primerMensaje(conflicto) ??
          'La fecha destino no está disponible: ya está bloqueada por otra reserva.';
        throw { tipo: 'no-disponible', motivo } satisfies CambiarFechaError;
      }

      if (status === 400 || status === 422) {
        const mensaje =
          primerMensaje(error as ErrorResponse | undefined) ??
          'La fecha indicada no es válida para esta consulta.';
        throw { tipo: 'validacion', mensaje } satisfies CambiarFechaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido cambiar la fecha. Inténtalo de nuevo.',
      } satisfies CambiarFechaError;
    },
    onSuccess: (reserva, { id }) => {
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...reserva } : reserva,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // El cambio de fecha regenera el borrador E1 (US-047): invalidar la lectura de
      // comunicaciones para que su contenido actualizado aparezca sin recargar (§D-4).
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(id) });
    },
  });
};
