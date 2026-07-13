import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import type {
  ActualizarDatosFiscalesClienteRequest,
  ActualizarDatosFiscalesClienteResponse,
} from '../model/types';

/** Variables del PATCH de datos fiscales del CLIENTE (US-014 · incidencia #5). */
export type ActualizarDatosFiscalesVars = {
  id: string;
  body: ActualizarDatosFiscalesClienteRequest;
};

/**
 * Mutación para completar/actualizar los datos fiscales del CLIENTE inline desde el
 * diálogo de presupuesto (US-014 · incidencia #5, Parte B). Consume el SDK generado
 * (`apiClient.PATCH('/reservas/{id}/datos-fiscales')`, operación
 * `actualizarDatosFiscalesCliente`): actualización PARCIAL de los 5 campos fiscales
 * del CLIENTE (`dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`); los
 * campos ausentes conservan su valor previo (D-2). NO toca la RESERVA ni el bloqueo.
 *
 * Desbloquea el error `DATOS_FISCALES_INCOMPLETOS` (422) del preview/confirmación:
 * tras un 200 se refresca la query de la RESERVA (`ReservaDetalle.cliente`) para que
 * la sección precargue los valores recién persistidos y se reintente la generación.
 *
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useActualizarDatosFiscales = () => {
  const queryClient = useQueryClient();

  return useMutation<
    ActualizarDatosFiscalesClienteResponse,
    Error,
    ActualizarDatosFiscalesVars
  >({
    mutationFn: async ({ id, body }) => {
      const { data, response } = await apiClient.PATCH('/reservas/{id}/datos-fiscales', {
        params: { path: { id } },
        body,
      });

      if (data) return data;

      throw new Error(
        `No se han podido guardar los datos fiscales del cliente (${response?.status ?? 'red'}).`,
      );
    },
    onSuccess: (_datos, { id }) => {
      // Los 5 campos se persistieron en CLIENTE; refresca la RESERVA para que la
      // sección precargue los valores actualizados en futuras aperturas/reintentos.
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
