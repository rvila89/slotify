import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { comunicacionesReservaQueryKey, type Comunicacion } from '@/features/comunicaciones';

/** Variables de la solicitud de datos fiscales al cliente (change solicitud-datos-presupuesto-borrador). */
export type SolicitarDatosPresupuestoVars = {
  /** ID de la RESERVA sobre la que se deja el borrador de solicitud de datos. */
  id: string;
};

/** Desenlaces de error normalizados a español para que la UI ramifique por `tipo` (no por status). */
export type SolicitarDatosPresupuestoError =
  | { tipo: 'duplicada'; mensaje: string }
  | { tipo: 'datos-completos'; mensaje: string }
  | { tipo: 'generico'; mensaje: string };

const MSG_DUPLICADA = 'Ya se solicitaron los datos a este cliente.';
const MSG_DATOS_COMPLETOS = 'Los datos fiscales del cliente ya están completos.';
const MSG_GENERICO = 'No se ha podido crear la solicitud. Inténtalo de nuevo.';

type CuerpoError = { codigo?: 'COMUNICACION_DUPLICADA' | 'DATOS_FISCALES_COMPLETOS' };

const normalizarError = (
  status: number | undefined,
  error: unknown,
): SolicitarDatosPresupuestoError => {
  const cuerpo = error as CuerpoError | undefined;
  if (cuerpo?.codigo === 'COMUNICACION_DUPLICADA' || status === 409)
    return { tipo: 'duplicada', mensaje: MSG_DUPLICADA };
  if (cuerpo?.codigo === 'DATOS_FISCALES_COMPLETOS' || status === 422)
    return { tipo: 'datos-completos', mensaje: MSG_DATOS_COMPLETOS };
  return { tipo: 'generico', mensaje: MSG_GENERICO };
};

/**
 * Mutación "Solicitar datos al cliente" desde el modal de presupuesto (change
 * solicitud-datos-presupuesto-borrador). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/comunicaciones/solicitar-datos-presupuesto')`, operación
 * `solicitarDatosPresupuesto`, sin body). No se edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `SolicitarDatosPresupuestoError` en español):
 *  - 201/200 `Comunicacion`: borrador de solicitud creado (o reutilizado si ya existía uno
 *    pendiente). Idempotente.
 *  - 409 `COMUNICACION_DUPLICADA` → `duplicada`: ya se envió una solicitud; no se reenvía.
 *  - 422 `DATOS_FISCALES_COMPLETOS` → `datos-completos`: los datos ya están completos.
 *
 * Tras éxito invalida el listado de comunicaciones de la reserva (para que el borrador
 * aparezca) Y la propia RESERVA (patrón `useEnviarBorrador`).
 */
export const useSolicitarDatosPresupuesto = () => {
  const queryClient = useQueryClient();

  return useMutation<Comunicacion, SolicitarDatosPresupuestoError, SolicitarDatosPresupuestoVars>({
    mutationFn: async ({ id }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/comunicaciones/solicitar-datos-presupuesto',
        { params: { path: { id } } },
      );
      if (data) return data;
      throw normalizarError(response?.status, error);
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
    },
  });
};
