/**
 * Normalizador de los errores del contrato del **reenvío de E3** (US-023 · GAP 3 · design.md
 * §D-reenvio-e3) a la unión `ReenvioE3Error` en español. El reenvío comparte el envelope
 * `FacturaSenalEnvioError` con el envío inicial; aquí solo se observan los `codigo` relevantes al
 * reenvío:
 *  - 409 `E3_NO_ENVIADO_PREVIAMENTE`: no hay un E3 enviado previamente que reenviar.
 *  - 404 `FACTURA_SENAL_NO_ENCONTRADA`: no existe factura de señal en la reserva/tenant.
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO`: fallo RECUPERABLE del reenvío (rollback total, reintentable).
 * Incluye fallback por status para no perder el desenlace si el `codigo` no llega.
 */
import type { ErrorResponse, ReenvioE3Error } from '../model/types';

type CodigoError =
  | 'FACTURA_SENAL_NO_ENCONTRADA'
  | 'E3_NO_ENVIADO_PREVIAMENTE'
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
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión `ReenvioE3Error`.
 * `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorReenvioE3 = (
  status: number | undefined,
  error: unknown,
): ReenvioE3Error => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'E3_NO_ENVIADO_PREVIAMENTE':
      return {
        tipo: 'no-enviado-previamente',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'No hay un E3 enviado previamente que reenviar.',
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
          'No se pudo reenviar el E3. Nada ha cambiado; inténtalo de nuevo.',
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
      tipo: 'no-enviado-previamente',
      mensaje:
        primerMensaje(cuerpo) ?? 'No hay un E3 enviado previamente que reenviar.',
    };
  }

  if (status === 502 || status === 503) {
    return {
      tipo: 'envio-fallido',
      mensaje:
        primerMensaje(cuerpo) ??
        'No se pudo reenviar el E3. Nada ha cambiado; inténtalo de nuevo.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido reenviar el E3. Inténtalo de nuevo.',
  };
};
