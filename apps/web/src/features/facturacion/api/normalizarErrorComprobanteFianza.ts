/**
 * Normalizador de los errores del contrato de la subida del comprobante de fianza
 * (fix-liquidacion-fianza-independientes) a la unión `ComprobanteFianzaError` en español.
 * Espejo de `normalizarErrorCondicionesFirmadas`. Mapea 1:1 los `codigo` del envelope
 * `SubirComprobanteFianzaValidacionError` (422), con fallback por status.
 */
import {
  MENSAJE_COMPROBANTE_REQUERIDO,
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_TAMANO_EXCEDIDO,
} from '../lib/comprobanteFianza';
import type { ComprobanteFianzaError, ErrorResponse } from '../model/types';

type CodigoError =
  | 'ESTADO_INVALIDO'
  | 'COMPROBANTE_REQUERIDO'
  | 'FORMATO_NO_PERMITIDO'
  | 'TAMANO_EXCEDIDO';

const MENSAJE_ESTADO_INVALIDO =
  'No se puede subir el comprobante de fianza en el estado actual de la reserva.';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `ComprobanteFianzaError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorComprobanteFianza = (
  status: number | undefined,
  error: unknown,
): ComprobanteFianzaError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError }) | undefined;

  switch (cuerpo?.codigo) {
    case 'ESTADO_INVALIDO':
      return {
        tipo: 'estado-invalido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_ESTADO_INVALIDO,
      };
    case 'COMPROBANTE_REQUERIDO':
      return {
        tipo: 'comprobante-requerido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_COMPROBANTE_REQUERIDO,
      };
    case 'FORMATO_NO_PERMITIDO':
      return {
        tipo: 'formato-no-permitido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_FORMATO_NO_PERMITIDO,
      };
    case 'TAMANO_EXCEDIDO':
      return {
        tipo: 'tamano-excedido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_TAMANO_EXCEDIDO,
      };
    default:
      break;
  }

  if (status === 422) {
    return {
      tipo: 'estado-invalido',
      mensaje: primerMensaje(cuerpo) ?? MENSAJE_ESTADO_INVALIDO,
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido subir el comprobante de fianza. Inténtalo de nuevo.',
  };
};
