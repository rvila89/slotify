import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type RegistrarIbanDevolucionResponse = components['schemas']['RegistrarIbanDevolucionResponse'];
type RegistrarIbanDevolucionConflictError =
  components['schemas']['RegistrarIbanDevolucionConflictError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Registrar IBAN de devolución" (US-035 · UC-26/UC-27). */
export type RegistrarIbanDevolucionVars = {
  id: string;
  iban: string;
};

/** Categoría del error del endpoint, normalizada para ramificar en español. */
export type RegistrarIbanError =
  | {
      /**
       * 422 (FA-01): el IBAN no supera la validación de checksum mod-97 en el
       * servidor. Sin efectos: no se persiste ni se envía E8. Se muestra inline
       * bajo el campo.
       */
      tipo: 'iban_invalido';
      mensaje: string;
    }
  | {
      /**
       * 409 (FA-04): la RESERVA no está en `post_evento` (`estado_no_post_evento`)
       * o no tiene fianza que devolver (`sin_fianza`). Sin efectos.
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

const MENSAJE_IBAN_INVALIDO =
  'El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud.';

/**
 * Mutación de la acción "Registrar IBAN de devolución" (US-035 · UC-26/UC-27).
 * Consume el SDK generado (`apiClient.PATCH('/reservas/{id}/iban-devolucion')`,
 * operación `registrarIbanDevolucion`, body `{ iban }`) y normaliza cada desenlace:
 *  - 200 `RegistrarIbanDevolucionResponse`: IBAN guardado en `CLIENTE.iban_devolucion`
 *    (normalizado). `avisoEmail` es NULO si E8 se envió, o `{ codigo:'e8_fallido', … }`
 *    si el IBAN quedó guardado pero E8 falló (FA-03). Un `avisoEmail` presente **no**
 *    es un error de la mutación: el IBAN sí se persistió (patrón guardar-luego-enviar,
 *    design.md §D-2), simétrico a `e5.fallido` en US-034. La ficha muestra la alerta
 *    con botón de reenvío.
 *  - 422 `iban_invalido` (FA-01): el servidor rechazó el IBAN por mod-97; se muestra
 *    inline bajo el campo.
 *  - 409 `conflicto` (FA-04): sin fianza / fuera de `post_evento`.
 *  - 401/403/404/red: `generico`.
 *
 * Tras un 200 invalida/actualiza la query de la reserva para refrescar el
 * `cliente.ibanDevolucion` precargado (FA-02). No se edita el cliente generado a mano.
 */
export const useRegistrarIbanDevolucion = () => {
  const queryClient = useQueryClient();

  return useMutation<
    RegistrarIbanDevolucionResponse,
    RegistrarIbanError,
    RegistrarIbanDevolucionVars
  >({
    mutationFn: async ({ id, iban }) => {
      const { data, error, response } = await apiClient.PATCH('/reservas/{id}/iban-devolucion', {
        params: { path: { id } },
        body: { iban },
      });

      if (data) return data;

      const status = response?.status;

      if (status === 422) {
        throw {
          tipo: 'iban_invalido',
          mensaje: primerMensaje(error as ErrorResponse | undefined) ?? MENSAJE_IBAN_INVALIDO,
        } satisfies RegistrarIbanError;
      }

      if (status === 409) {
        const conflicto = error as RegistrarIbanDevolucionConflictError | undefined;
        const mensaje =
          primerMensaje(conflicto) ??
          'No se puede registrar el IBAN: la reserva no está en post-evento o no tiene fianza que devolver.';
        throw { tipo: 'conflicto', mensaje } satisfies RegistrarIbanError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido registrar el IBAN. Inténtalo de nuevo.',
      } satisfies RegistrarIbanError;
    },
    onSuccess: (_respuesta, { id }) => {
      // El IBAN se persistió en CLIENTE; refresca la reserva para reflejar el
      // `cliente.ibanDevolucion` precargado en futuras aperturas de la ficha (FA-02).
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
