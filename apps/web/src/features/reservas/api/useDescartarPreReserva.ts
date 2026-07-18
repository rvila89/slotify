import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';
import { reservasActivasQueryKey } from './useReservasActivas';
import { MENSAJE_DESCARTE_PRERESERVA_TERMINAL } from '../lib/descartarPreReserva';

type Reserva = components['schemas']['Reserva'];
type DescartarConsultaConflictError = components['schemas']['DescartarConsultaConflictError'];
type DescartarReservaOrigenInvalidoError =
  components['schemas']['DescartarReservaOrigenInvalidoError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Descartar pre-reserva" (workstream B). */
export type DescartarPreReservaVars = {
  id: string;
  /** Motivo OPCIONAL del descarte; el backend lo audita en `AUDIT_LOG`. */
  motivo?: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type DescartarPreReservaError =
  | {
      /**
       * 409 `transicion_no_permitida` (RC-3 / RC-1): la RESERVA ya está en un
       * estado terminal — incluye el doble descarte concurrente (segunda petición)
       * y la carrera perdida contra la expiración de TTL de la pre-reserva
       * (US-012), que ya la dejó en `reserva_cancelada`. Sin efectos.
       */
      tipo: 'conflicto';
      mensaje: string;
    }
  | {
      /**
       * 422 origen inválido: la RESERVA está en un estado que NO es descartable como
       * pre-reserva (`reserva_confirmada` o posteriores no terminales). Sin efectos.
       */
      tipo: 'origen_invalido';
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
 * Mutación de la acción "Descartar pre-reserva" (workstream B de
 * `presupuesto-prereserva-cta-descarte-y-e2`). Consume el **MISMO** endpoint de
 * descarte que US-013 —`apiClient.POST('/reservas/{id}/descartar')`, operación
 * `descartarConsultaPorCliente`, body `{ motivo? }` opcional— cuya semántica se
 * amplió (D-2) para despachar por fase: el frontend NO conoce una operación
 * `descartar-prereserva`, solo invoca `descartar` sobre una RESERVA que sabe en
 * `pre_reserva`, y el backend resuelve la transición `pre_reserva →
 * reserva_cancelada`. Normaliza cada desenlace:
 *  - 200 `Reserva`: RESERVA en `estado='reserva_cancelada'` (`subEstado=null`,
 *    `ttlExpiracion=null`, terminal). Si la fecha tenía cola, la promoción A15
 *    cambia OTRA RESERVA por separado (no viaja en la respuesta).
 *  - 409 `transicion_no_permitida` → `conflicto` (RESERVA ya terminal / carrera).
 *  - 422 origen inválido → `origen_invalido` (estado no descartable).
 *  - 401/403/404/red → `generico`.
 *
 * Tras éxito se re-consulta el estado servidor porque los efectos secundarios
 * (liberación de fecha + promoción/reordenación de cola) son **invisibles en la
 * respuesta** y afectan a OTRAS reservas (mismo patrón que el descarte de consulta):
 *  - Se mergea la RESERVA cancelada en su cache y se invalida su query.
 *  - Se invalida el listado de reservas activas (pipeline/kanban): la descartada
 *    sale del pipeline y la promovida/reordenada aparece con su nuevo estado.
 *
 * No se edita el cliente generado a mano (regla dura del proyecto).
 */
export const useDescartarPreReserva = () => {
  const queryClient = useQueryClient();

  return useMutation<Reserva, DescartarPreReservaError, DescartarPreReservaVars>({
    mutationFn: async ({ id, motivo }) => {
      const motivoLimpio = motivo?.trim();
      const { data, error, response } = await apiClient.POST('/reservas/{id}/descartar', {
        params: { path: { id } },
        // Body opcional: se envía `motivo` solo si el gestor lo escribió; su
        // ausencia no bloquea la transición a `reserva_cancelada`.
        body: motivoLimpio ? { motivo: motivoLimpio } : {},
      });

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as DescartarConsultaConflictError | undefined;
        const mensaje = primerMensaje(conflicto) ?? MENSAJE_DESCARTE_PRERESERVA_TERMINAL;
        throw { tipo: 'conflicto', mensaje } satisfies DescartarPreReservaError;
      }

      if (status === 422) {
        const origen = error as DescartarReservaOrigenInvalidoError | undefined;
        const mensaje =
          primerMensaje(origen) ??
          'Esta reserva no puede descartarse como pre-reserva en su estado actual.';
        throw { tipo: 'origen_invalido', mensaje } satisfies DescartarPreReservaError;
      }

      throw {
        tipo: 'generico',
        mensaje: 'No se ha podido descartar la pre-reserva. Inténtalo de nuevo.',
      } satisfies DescartarPreReservaError;
    },
    onSuccess: (respuesta, { id }) => {
      // Mergea la RESERVA cancelada en la cache de la reserva y refetch.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...respuesta } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      // La descartada sale del pipeline y la promoción/reordenación de cola es
      // invisible en la respuesta: re-consultar el listado activo.
      void queryClient.invalidateQueries({ queryKey: reservasActivasQueryKey });
    },
  });
};
