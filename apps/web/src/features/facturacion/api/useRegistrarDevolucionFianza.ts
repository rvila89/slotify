import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api-client';
import { reservaQueryKey } from '@/features/reservas';
import { normalizarErrorDevolucionFianza } from './normalizarErrorDevolucionFianza';
import { facturasReservaQueryKey } from './useFacturasReserva';
import type { DevolucionFianzaError, RegistrarDevolucionFianzaResponse } from '../model/types';

/** Variables del registro de la devolución de fianza (US-036 · UC-27). */
export type RegistrarDevolucionFianzaVars = {
  /** ID de la RESERVA (path del endpoint y clave de las queries cacheadas). */
  reservaId: string;
  /** Importe devuelto como `Importe` (string decimal, p. ej. "1000.00"); `0.00 ≤ x ≤ fianzaEur`. */
  importeDevuelto: string;
  /** Fecha real del abono (DATE `YYYY-MM-DD`); DEBE ser ≥ `fianzaCobradaFecha`. */
  fechaCobro: string;
  /** OBLIGATORIO solo si la devolución es parcial (`importeDevuelto < fianzaEur`); texto libre. */
  motivoRetencion?: string;
  /** OPCIONAL (FA-04): id de un DOCUMENTO `justificante_pago` YA subido; sin él la devolución es válida. */
  justificanteDocId?: string;
};

/**
 * Mutación de **registro de la devolución de fianza** (US-036 · UC-27). Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/fianza/devolucion')`, operación `registrarDevolucionFianza`).
 * En una única transacción atómica el backend vincula el justificante (si se referenció), transiciona
 * `RESERVA.fianzaStatus` a `devuelta` o `retenida_parcial` (derivado del importe) y persiste
 * `fianzaDevueltaEur`/`fianzaDevueltaFecha`/`motivoRetencion`. La guarda de doble registro
 * (`SELECT ... FOR UPDATE`) rechaza un segundo intento con 409.
 *
 * Desenlaces:
 *  - 200 → devolución registrada; `avisoSinJustificante=true` si se registró sin justificante (FA-04).
 *  - 400 `IMPORTE_SUPERA_FIANZA` / `FECHA_DEVOLUCION_INVALIDA` / `MOTIVO_RETENCION_REQUERIDO`.
 *  - 404 `JUSTIFICANTE_NO_ENCONTRADO`.
 *  - 409 `PRECONDICION_NO_CUMPLIDA` / `DEVOLUCION_YA_REGISTRADA`.
 *
 * Tras un registro efectivo invalida la reserva (para reflejar `fianzaStatus`, `fianzaDevueltaEur`,
 * `fianzaDevueltaFecha` y `motivoRetencion`) y la colección de facturas. No se edita el cliente
 * generado a mano.
 */
export const useRegistrarDevolucionFianza = () => {
  const queryClient = useQueryClient();

  return useMutation<
    RegistrarDevolucionFianzaResponse,
    DevolucionFianzaError,
    RegistrarDevolucionFianzaVars
  >({
    mutationFn: async ({ reservaId, importeDevuelto, fechaCobro, motivoRetencion, justificanteDocId }) => {
      const { data, error, response } = await apiClient.POST(
        '/reservas/{id}/fianza/devolucion',
        {
          params: { path: { id: reservaId } },
          body: {
            importeDevuelto,
            fechaCobro,
            ...(motivoRetencion ? { motivoRetencion } : {}),
            ...(justificanteDocId ? { justificanteDocId } : {}),
          },
        },
      );
      if (data) return data;
      throw normalizarErrorDevolucionFianza(response?.status, error);
    },
    onSuccess: (_data, { reservaId }) => {
      void queryClient.invalidateQueries({ queryKey: reservaQueryKey(reservaId) });
      void queryClient.invalidateQueries({ queryKey: facturasReservaQueryKey(reservaId) });
    },
  });
};
