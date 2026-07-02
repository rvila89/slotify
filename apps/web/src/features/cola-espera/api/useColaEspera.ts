import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { ColaEsperaResponse } from '../model/types';

/**
 * Error de carga de la cola que distingue el 404 (reserva inexistente o de otro
 * tenant bajo RLS) del resto de fallos, para que la página muestre un estado de
 * "no encontrada" (FA-404) diferenciado del error genérico.
 */
export class ColaEsperaError extends Error {
  readonly noEncontrada: boolean;

  constructor(mensaje: string, noEncontrada: boolean) {
    super(mensaje);
    this.name = 'ColaEsperaError';
    this.noEncontrada = noEncontrada;
  }
}

/** Clave de query de la cola de una reserva bloqueante concreta. */
export const colaEsperaQueryKey = (id: string) => ['cola-espera', id] as const;

/**
 * Estado de servidor de la cola de espera de una fecha (US-017), leído a través
 * del SDK generado (`apiClient.GET('/reservas/{id}/cola')`, única vía a la API;
 * no se edita el cliente a mano). Vista de SOLO LECTURA: `useQuery`, sin
 * mutación. El 404 se propaga como `ColaEsperaError` con `noEncontrada = true`
 * para diferenciarlo del error de red/servidor. El caso FA-04 (fecha disponible)
 * NO es error: llega como 200 con `estaBloqueada: false`.
 */
export const useColaEspera = (id: string | undefined) =>
  useQuery({
    queryKey: colaEsperaQueryKey(id ?? ''),
    enabled: Boolean(id),
    retry: (fallos, error) =>
      !(error instanceof ColaEsperaError && error.noEncontrada) && fallos < 1,
    queryFn: async (): Promise<ColaEsperaResponse> => {
      const { data, error, response } = await apiClient.GET('/reservas/{id}/cola', {
        params: { path: { id: id as string } },
      });
      if (response.status === 404) {
        throw new ColaEsperaError('La reserva no existe o no es accesible.', true);
      }
      if (error || !data) {
        throw new ColaEsperaError(
          `No se ha podido cargar la cola de espera (${response.status || 'red'}).`,
          false,
        );
      }
      return data;
    },
  });
