import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { normalizarErrorEnvioSenal } from './normalizarErrorEnvioSenal';
import { facturaSenalQueryKey } from './useFacturaSenal';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { EnviarFacturaSenalResponse, EnvioSenalError } from '../model/types';

/** Variables del envío de la factura de señal 40% + condicions particulars por E3 (6.4b). */
export type EnviarFacturaSenalVars = {
  /** ID de la RESERVA (path del endpoint y clave de las queries de facturas cacheadas). */
  reservaId: string;
};

/**
 * Mutación de **envío manual de la factura de señal (40%) + condicions particulars por email
 * E3** (rebanada 6.4b). Es la acción del Gestor que remite al cliente la factura de señal ya
 * emitida junto con las condicions particulars. Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/facturas/senal/enviar')`, operación `enviarFacturaSenal`,
 * cuerpo vacío). No se edita el cliente generado a mano.
 *
 * Desenlaces (normalizados a `EnvioSenalError` en español):
 *  - 200: `EnviarFacturaSenalResponse` (`factura` enviada + `condPartEnviadasFecha` +
 *    `condPartAdjuntada`). Si `condPartAdjuntada=false` el email salió solo con la señal
 *    (tenant sin condiciones o fallo de render); la UI lo avisa.
 *  - 404 `FACTURA_SENAL_NO_ENCONTRADA` → no existe factura de señal.
 *  - 409 `E3_YA_ENVIADO` → idempotencia: ya se envió, sin re-envío.
 *  - 409 `FACTURA_SENAL_NO_ENVIABLE` → la factura no está en un estado enviable.
 *  - 502 `EMISION_ENVIO_FALLIDO` → fallo recuperable, reintentable.
 *
 * Tras éxito invalida la factura de señal y la colección de facturas de la reserva para
 * reflejar el nuevo estado y la fecha de envío de E3.
 */
export const useEnviarFacturaSenal = () => {
  const queryClient = useQueryClient();

  return useMutation<EnviarFacturaSenalResponse, EnvioSenalError, EnviarFacturaSenalVars>({
    mutationFn: async ({ reservaId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/facturas/senal/enviar',
        { params: { path: { id: reservaId } } },
      );
      if (data) return data;
      throw normalizarErrorEnvioSenal(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: facturaSenalQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: facturasReservaQueryKey(reservaId) });
    },
  });
};
