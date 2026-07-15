/**
 * Normalizador de los errores del contrato de la rebanada 6.4b (envío de la factura de
 * señal 40% + condicions particulars por email E3) a la unión `EnvioSenalError` en
 * español. Mapea 1:1 los `codigo` del envelope `FacturaSenalEnvioError`:
 *  - 404 `FACTURA_SENAL_NO_ENCONTRADA`: no existe factura de señal en la reserva/tenant.
 *  - 409 `E3_YA_ENVIADO`: idempotencia — el email E3 ya se envió; no hay re-envío.
 *  - 409 `FACTURA_SENAL_NO_ENVIABLE`: la factura no está en un estado que permita enviar
 *    (p. ej. `rechazada`/no emitida).
 *  - 502 `EMISION_ENVIO_FALLIDO`: fallo RECUPERABLE del envío (rollback total, reintentable).
 * Incluye fallback por status para no perder el desenlace si el `codigo` no llega.
 */
import type { EnvioSenalError, ErrorResponse } from '../model/types';

type CodigoError =
  | 'FACTURA_SENAL_NO_ENCONTRADA'
  | 'FACTURA_SENAL_NO_ENVIABLE'
  | 'E3_YA_ENVIADO'
  | 'EMISION_ENVIO_FALLIDO';

type CuerpoError = ErrorResponse & {
  codigo?: CodigoError;
  motivo?: string;
};

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `EnvioSenalError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorEnvioSenal = (
  status: number | undefined,
  error: unknown,
): EnvioSenalError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'E3_YA_ENVIADO':
      return {
        tipo: 'ya-enviado',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'La factura de señal ya se envió al cliente. No se ha vuelto a enviar.',
      };
    case 'FACTURA_SENAL_NO_ENVIABLE':
      return {
        tipo: 'no-enviable',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'La factura de señal no está en un estado que permita enviarla.',
      };
    case 'FACTURA_SENAL_NO_ENCONTRADA':
      return {
        tipo: 'no-encontrada',
        mensaje:
          cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'No existe factura de señal en esta reserva.',
      };
    case 'EMISION_ENVIO_FALLIDO':
      return {
        tipo: 'envio-fallido',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'No se pudo enviar el email. Nada ha cambiado; inténtalo de nuevo.',
      };
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el desenlace.
  if (status === 404) {
    return {
      tipo: 'no-encontrada',
      mensaje: primerMensaje(cuerpo) ?? 'No existe factura de señal en esta reserva.',
    };
  }

  if (status === 409) {
    return {
      tipo: 'no-enviable',
      mensaje:
        primerMensaje(cuerpo) ?? 'La factura de señal no está en un estado que permita enviarla.',
    };
  }

  if (status === 502 || status === 503) {
    return {
      tipo: 'envio-fallido',
      mensaje:
        primerMensaje(cuerpo) ??
        'No se pudo enviar el email. Nada ha cambiado; inténtalo de nuevo.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido enviar la factura de señal. Inténtalo de nuevo.',
  };
};
