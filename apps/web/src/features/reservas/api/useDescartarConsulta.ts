import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';
import { reservasActivasQueryKey } from './useReservasActivas';
import { MENSAJE_DESCARTE_TERMINAL } from '../lib/descartarConsulta';

type Reserva = components['schemas']['Reserva'];
type DescartarConsultaConflictError = components['schemas']['DescartarConsultaConflictError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Marcar como descartada por cliente" (US-013 · UC-10). */
export type DescartarConsultaVars = {
  id: string;
  /** Motivo OPCIONAL del descarte; el backend lo anexa a `RESERVA.notas`. */
  motivo?: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type DescartarConsultaError =
  | {
      /**
       * 409 `transicion_no_permitida` (RC-3 / RC-1): la RESERVA está en un
       * sub_estado terminal (`2x/2y/2z`) o estado terminal — incluye el doble
       * descarte concurrente (segunda petición) y la carrera perdida contra el
       * barrido de TTL de US-012. Sin efectos: no se ha modificado nada.
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
  return Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : undefined;
};

/**
 * Mutación de la acción "Marcar como descartada por cliente" (US-013 · UC-10,
 * A17 manual). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/descartar')`, operación
 * `descartarConsultaPorCliente`, body `{ motivo? }` opcional) y normaliza cada
 * desenlace:
 *  - 200 `Reserva`: RESERVA en `estado='consulta'`, `subEstado='2z'` (terminal).
 *    Si el origen (`2b`/`2v` con cola) disparó la promoción A15, la RESERVA
 *    promovida cambia POR SEPARADO y NO viaja en esta respuesta.
 *  - 409 `transicion_no_permitida` → `conflicto`, sin mutar la RESERVA.
 *  - 401/403/404/red → `generico`.
 *
 * Tras éxito se re-consulta el estado servidor porque los efectos secundarios del
 * descarte son **invisibles en la respuesta**: la promoción de la cola en `2b/2v`
 * y la reordenación en `2d` afectan a OTRAS reservas (mismo patrón que
 * "salir de cola"/"promover"). Por eso:
 *  - Se mergea `2z` en la cache de esta reserva y se invalida su query.
 *  - Se invalida el listado de reservas activas (pipeline/kanban): la descartada
 *    sale del pipeline y la promovida/reordenada aparece con su nuevo estado.
 *
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useDescartarConsulta = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, DescartarConsultaError, DescartarConsultaVars>({
    mutationFn: async ({ id, motivo }) => {
      const motivoLimpio = motivo?.trim();
      const { data, error, response } = await apiClient.POST('/reservas/{id}/descartar', {
        params: { path: { id } },
        // Body opcional: se envía `motivo` solo si el gestor lo escribió; su
        // ausencia no bloquea ni retrasa la transición a `2z` (US-013 §Validación).
        body: motivoLimpio ? { motivo: motivoLimpio } : {},
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as DescartarConsultaConflictError | undefined;
        const mensaje = primerMensaje(conflicto) ?? MENSAJE_DESCARTE_TERMINAL;
        throw { tipo: 'conflicto', mensaje } satisfies DescartarConsultaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido descartar la consulta. Inténtalo de nuevo.',
      } satisfies DescartarConsultaError;
    },
    onSuccess: (respuesta, { id }) => {
      // Mergea el sub_estado `2z` en la cache de la reserva y refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...respuesta } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // La descartada sale del pipeline y la promoción/reordenación de cola
      // (2b/2v/2d) es invisible en la respuesta: re-consultar el listado activo.
      void queryClient.invalidateQueries({ queryKey: reservasActivasQueryKey });
    },
  });
};
