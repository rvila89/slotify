import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type {
  CreateReservaRequest,
  CreateReservaResponse,
  ErrorResponse,
} from '../model/types';

/** Variables de la mutación de alta: el `body` del contrato + metadatos de UI. */
export type VariablesAlta = {
  body: CreateReservaRequest;
  tieneComentarios: boolean;
  fechaEnviada: string;
};

/** Error normalizado del alta (status HTTP + cuerpo de error del contrato). */
export type ErrorAlta = { status?: number; body?: ErrorResponse };

/**
 * Mutación de alta de consulta (US-003/US-004). Consume el SDK generado
 * (`apiClient.POST('/reservas')`, única vía a la API) y normaliza el fallo a
 * `ErrorAlta`. El mapeo de la respuesta a estado de UI (avisos 2b/2d/2a/E1) y de
 * los errores 400 a campos del formulario lo resuelve la página vía las opciones
 * `onSuccess`/`onError` de `mutate`, que disponen del estado y del `setError`.
 */
export const useCrearConsulta = () =>
  useMutation<CreateReservaResponse, ErrorAlta, VariablesAlta>({
    mutationFn: async ({ body }: VariablesAlta) => {
      const { data, error, response } = await apiClient.POST('/reservas', { body });
      if (error || !data) {
        throw {
          status: response?.status,
          body: error as ErrorResponse | undefined,
        } satisfies ErrorAlta;
      }
      return data;
    },
  });
