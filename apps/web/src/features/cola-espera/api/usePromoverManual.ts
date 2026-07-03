import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { colaEsperaQueryKey } from './useColaEspera';

type Reserva = components['schemas']['Reserva'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Variables de la promoción manual (US-019 · UC-12 FA manual).
 *  - `id`: RESERVA en `2.d` que el Gestor elige promover (cualquier `posicionCola`).
 *  - `bloqueanteId`: id de la bloqueante actual (route param de la vista de cola),
 *    necesario SOLO para invalidar la query de la cola tras el éxito.
 */
export type PromoverManualVars = {
  id: string;
  bloqueanteId: string;
};

/**
 * Categoría del error del endpoint, normalizada para que la UI ramifique en español.
 * El texto exacto del 409 es la salvaguarda del arbitraje D-4 (carrera perdida).
 */
export type PromoverManualError =
  | {
      /**
       * 409: carrera perdida. El barrido automático (US-018) u otro Gestor tomó el
       * lock primero y ya promovió; o inconsistencia (sin FECHA_BLOQUEADA activa). La
       * vista DEBE recargarse para reflejar el estado real.
       */
      tipo: 'conflicto';
      mensaje: string;
    }
  | {
      /** 422: la consulta seleccionada ya no está en cola (FA-05) o falta confirmación. */
      tipo: 'validacion';
      mensaje: string;
    }
  | {
      /** 403: el actor no tiene rol Gestor para promover. */
      tipo: 'sin_permiso';
      mensaje: string;
    }
  | {
      /** 401/404/red u otros: error genérico de reintento. */
      tipo: 'generico';
      mensaje: string;
    };

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Mensaje canónico del arbitraje D-4 (carrera perdida contra la promoción automática). */
export const MENSAJE_COLA_ACTUALIZADA =
  'La cola ya fue actualizada automáticamente, por favor recarga la vista.';

/**
 * Mutación de la promoción manual de una consulta de la cola (US-019 · UC-12 flujo
 * alternativo manual, actor Gestor). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/promover')`, body `{ confirmado: true }`, modo
 * manual del contrato D-1); NUNCA se edita el cliente a mano.
 *
 * La acción es DESTRUCTIVA (expira forzosamente la bloqueante activa a `2.x`), así que
 * el disparo va precedido por un diálogo de confirmación explícito en la UI. El body
 * `confirmado: true` es la defensa en servidor de esa confirmación.
 *
 * Normaliza cada desenlace:
 *  - 200: RESERVA promovida a `2.b`; la bloqueante anterior quedó en `2.x` y la cola
 *    reordenada por cierre de hueco (todo server-side).
 *  - 409 `conflicto`: carrera perdida (D-4). Se propaga el mensaje canónico y, además,
 *    se invalida la query de la cola para forzar la recarga del estado real.
 *  - 422 `validacion`: la consulta ya no está en `2.d` (FA-05) o inconsistencia de
 *    confirmación; manda el mensaje del servidor.
 *  - 403 `sin_permiso`: el actor no es Gestor.
 *  - genérico: reintento.
 *
 * En éxito Y en 409 invalida `colaEsperaQueryKey(bloqueanteId)`: en ambos casos el
 * estado del servidor cambió y la vista debe re-leerse.
 */
export const usePromoverManual = () => {
  const queryClient = useQueryClient();

  const invalidarCola = (bloqueanteId: string) =>
    queryClient.invalidateQueries({ queryKey: colaEsperaQueryKey(bloqueanteId) });

  return useMutation<Reserva, PromoverManualError, PromoverManualVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST('/reservas/{id}/promover', {
        params: { path: { id } },
        body: { confirmado: true },
      });

      if (data) return data;

      const status = response?.status;
      const cuerpo = error as ErrorResponse | undefined;

      if (status === 409) {
        throw {
          tipo: 'conflicto',
          mensaje: primerMensaje(cuerpo) ?? MENSAJE_COLA_ACTUALIZADA,
        } satisfies PromoverManualError;
      }
      if (status === 422 || status === 400) {
        throw {
          tipo: 'validacion',
          mensaje:
            primerMensaje(cuerpo) ?? 'La consulta seleccionada ya no está en cola.',
        } satisfies PromoverManualError;
      }
      if (status === 403) {
        throw {
          tipo: 'sin_permiso',
          mensaje:
            primerMensaje(cuerpo) ??
            'No tienes permisos para promover consultas de la cola.',
        } satisfies PromoverManualError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido promover la consulta. Inténtalo de nuevo.',
      } satisfies PromoverManualError;
    },
    onSuccess: (_reserva, { bloqueanteId }) => {
      void invalidarCola(bloqueanteId);
    },
    onError: (err, { bloqueanteId }) => {
      // D-4: en carrera perdida el estado ya cambió en servidor → recargar la vista.
      if (err.tipo === 'conflicto') void invalidarCola(bloqueanteId);
    },
  });
};
