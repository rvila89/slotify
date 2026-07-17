import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type components } from '@/api-client';
import { reservaQueryKey } from './useReserva';

type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];
type ForzarInicioEventoConflictError = components['schemas']['ForzarInicioEventoConflictError'];
type ForzarInicioEventoFechaError = components['schemas']['ForzarInicioEventoFechaError'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/** Variables de la acción "Forzar inicio del evento" (US-032 · UC-23 FA-01). */
export type ForzarInicioEventoVars = {
  id: string;
};

/** Categoría del error del endpoint, normalizada para que la UI ramifique en español. */
export type ForzarInicioEventoError =
  | {
      /**
       * 409 `conflicto_estado`: la RESERVA no está en `reserva_confirmada` (el cron de
       * US-031 llegó primero y ya está en `evento_en_curso`, otra sesión ganó la
       * carrera, u otro estado). Sin efectos: la RESERVA no se ha modificado.
       */
      tipo: 'conflicto';
      mensaje: string;
    }
  | {
      /**
       * 422 `fecha_evento_no_es_hoy`: `estado = reserva_confirmada` pero la fecha del
       * evento no es hoy. Defensa de servidor; no debería alcanzarse desde el botón
       * (la guarda de cliente ya lo oculta fuera del día del evento).
       */
      tipo: 'fuera_de_dia';
      mensaje: string;
    }
  | {
      /** 401/403/404/red u otros: error genérico. */
      tipo: 'generico';
      mensaje: string;
    };

const MENSAJE_CONFLICTO =
  'El evento ya está en curso (iniciado automáticamente o por otro usuario). No es necesaria ninguna acción.';
const MENSAJE_FUERA_DE_DIA = 'El forzado solo está disponible el día del evento.';
const MENSAJE_GENERICO = 'No se ha podido forzar el inicio del evento. Inténtalo de nuevo.';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  if (Array.isArray(m)) return m.join(' ');
  return typeof m === 'string' ? m : undefined;
};

/**
 * Mutación de la acción "Forzar inicio del evento" (US-032 · UC-23 FA-01). Consume el
 * SDK generado (`apiClient.POST('/reservas/{id}/forzar-inicio-evento')`, operación
 * `forzarInicioEvento`, body vacío) y normaliza cada desenlace (design.md §D-1/§D-6):
 *  - 200 `ForzarInicioEventoResponse`: RESERVA en `estado='evento_en_curso'` +
 *    `forzadoPorGestor=true` + `precondicionesIncumplidas: string[]` (evidencia del
 *    override). El forzado NO resuelve los sub-procesos incumplidos (D-5): los
 *    `*_status` conservan su valor.
 *  - 409 `conflicto_estado`: la RESERVA no está en `reserva_confirmada` (el cron de
 *    US-031 llegó primero / carrera perdida / otro estado) → `conflicto`, sin efectos.
 *  - 422 `fecha_evento_no_es_hoy`: fuera del día del evento → `fuera_de_dia` (defensa).
 *  - 401/403/404/red: `generico`.
 *
 * Tras éxito mergea `evento_en_curso` en la cache e invalida la query de la reserva
 * para refrescar su estado. En un 409 también invalida (idempotencia observable: la
 * ficha refleja `evento_en_curso`). No se edita el cliente generado a mano (regla dura).
 */
export const useForzarInicioEvento = () => {
  const queryClient = useQueryClient();

  return useMutation<ForzarInicioEventoResponse, ForzarInicioEventoError, ForzarInicioEventoVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/forzar-inicio-evento',
        {
          params: { path: { id } },
          // Cuerpo vacío (Record<string, never>): la única entrada es el path y el
          // Gestor autenticado (JWT). Se envía `{}` para satisfacer el tipo generado.
          body: {},
        },
      );

      if (data) return data;

      const status = response?.status;

      if (status === 409) {
        const conflicto = error as ForzarInicioEventoConflictError | undefined;
        throw {
          tipo: 'conflicto',
          mensaje: primerMensaje(conflicto) ?? MENSAJE_CONFLICTO,
        } satisfies ForzarInicioEventoError;
      }

      if (status === 422) {
        const fecha = error as ForzarInicioEventoFechaError | undefined;
        throw {
          tipo: 'fuera_de_dia',
          mensaje: primerMensaje(fecha) ?? MENSAJE_FUERA_DE_DIA,
        } satisfies ForzarInicioEventoError;
      }

      throw { tipo: 'generico', mensaje: MENSAJE_GENERICO } satisfies ForzarInicioEventoError;
    },
    onSuccess: (respuesta, { id }) => {
      // La respuesta extiende `Reserva`: mergea el estado `evento_en_curso` en la
      // cache y refetch para reflejar la transición en la ficha.
      queryClient.setQueryData(reservaQueryKey(id), (prev) =>
        prev ? { ...prev, ...respuesta } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
    onError: (err, { id }) => {
      // Idempotencia observable (D-6): el cron/otra sesión ya inició el evento → la
      // ficha debe refrescar para mostrar `evento_en_curso`. También en 422 refresca
      // por si la fecha/estado cambió desde el último fetch.
      if (err.tipo === 'conflicto' || err.tipo === 'fuera_de_dia') {
        void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
      }
    },
  });
};
