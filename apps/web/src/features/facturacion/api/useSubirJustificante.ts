import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import type { Documento } from '../model/types';

/** Variables de la subida del justificante de pago (paso 1 de la devolución, US-036 · G1-3). */
export type SubirJustificanteVars = {
  /** Fichero JPEG/PNG/PDF (≤ 10 MB) validado en cliente antes de subir. */
  fichero: File;
  /** RESERVA a la que se vincula el DOCUMENTO (`reservaId`), para acotar por reserva y tenant. */
  reservaId: string;
};

/**
 * Mutación de **subida del justificante** (`POST /documentos`, multipart), primer paso del patrón
 * de dos pasos de US-036/US-030 (G1-3): el fichero se sube por el endpoint genérico de documentos
 * (que crea el DOCUMENTO `tipo='justificante_pago'`) y devuelve su `idDocumento`, que luego se pasa
 * como `justificanteDocId` en el body JSON de `POST /reservas/{id}/fianza/devolucion`.
 *
 * El SDK generado acepta el body multipart directamente; `openapi-fetch` serializa `FormData` a
 * partir del objeto `body` cuando el content-type es `multipart/form-data`. No se edita el cliente
 * generado a mano.
 */
export const useSubirJustificante = () =>
  useMutation<Documento, unknown, SubirJustificanteVars>({
    mutationFn: async ({ fichero, reservaId }) => {
      const { data, error } = await apiClient.POST('/documentos', {
        body: {
          file: fichero as unknown as string,
          tipo: 'justificante_pago',
          reservaId,
        },
        bodySerializer: (body) => {
          const formData = new FormData();
          formData.append('file', (body as { file: unknown }).file as Blob);
          formData.append('tipo', (body as { tipo: string }).tipo);
          formData.append('reservaId', (body as { reservaId: string }).reservaId);
          return formData;
        },
      });
      if (data) return data;
      throw error;
    },
  });
