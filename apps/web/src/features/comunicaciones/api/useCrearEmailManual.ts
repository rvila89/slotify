import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorEmailManual } from './normalizarError';
import { comunicacionesReservaQueryKey } from './useComunicacionesReserva';
import type { Comunicacion, CrearEmailManualError } from '../model/types';

/** Variables del email manual (US-046 · UC-36). `asunto`/`cuerpo` obligatorios. */
export type CrearEmailManualVars = {
  reservaId: string;
  asunto: string;
  cuerpo: string;
};

/**
 * Mutación de "nuevo email manual" (US-046 · UC-36). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/comunicaciones/manual')`, operación
 * `crearEmailManual`). Crea y envía una nueva `COMUNICACION` con `codigoEmail='manual'`,
 * `estado='enviado'` y `fechaEnvio` no nulo, anclada a la RESERVA y su CLIENTE. No se
 * edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `CrearEmailManualError` en español):
 *  - 201 `Comunicacion`: creada y enviada.
 *  - 422 `DESTINATARIO_INVALIDO` → `destinatario`: `CLIENTE.email` inválido; no se creó nada.
 *  - 502 `PROVEEDOR_EMAIL_FALLIDO` → `proveedor`: la fila quedó `fallido`; reintentable.
 *
 * Tras éxito (y en el 502, porque quedó persistida la fila `fallido`) invalida el listado.
 */
export const useCrearEmailManual = () => {
  const queryClient = useQueryClient();

  return useMutation<Comunicacion, CrearEmailManualError, CrearEmailManualVars>({
    mutationFn: async ({ reservaId, asunto, cuerpo }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/comunicaciones/manual',
        { params: { path: { id: reservaId } }, body: { asunto, cuerpo } },
      );
      if (data) return data;
      throw normalizarErrorEmailManual(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
    },
    onError: (err, { reservaId }) => {
      if (err.tipo === 'proveedor') {
        void queryClient.invalidateQueries({ queryKey: comunicacionesReservaQueryKey(reservaId) });
      }
    },
  });
};
