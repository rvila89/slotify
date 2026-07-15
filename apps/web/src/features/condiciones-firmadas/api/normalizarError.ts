/**
 * Normalizador de los errores del contrato de registro de firma (US-024) a la unión
 * `CondicionesFirmadasError` en español. Mapea 1:1 los `codigo` del envelope de
 * error (409 `CondicionesFirmadasConflictoError` / 422 `CondicionesFirmadasValidacionError`),
 * con fallback por status para no perder el 409/422 si el `codigo` no llega.
 */
import {
  MENSAJE_CONDICIONES_REQUERIDAS,
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_TAMANO_EXCEDIDO,
} from '../lib/fichero';
import { MENSAJE_CONDICIONES_NO_ENVIADAS } from '../lib/estado';
import type { CondicionesFirmadasError, ErrorResponse } from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error del contrato de US-024 (409 conflicto + 422 validación). */
type CodigoError =
  | 'CONDICIONES_NO_ENVIADAS'
  | 'ESTADO_INVALIDO'
  | 'CONDICIONES_REQUERIDAS'
  | 'FORMATO_NO_PERMITIDO'
  | 'TAMANO_EXCEDIDO';

const MENSAJE_ESTADO_INVALIDO =
  'No se puede registrar la firma en una reserva en estado terminal';

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `CondicionesFirmadasError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorCondicionesFirmadas = (
  status: number | undefined,
  error: unknown,
): CondicionesFirmadasError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError }) | undefined;

  switch (cuerpo?.codigo) {
    case 'CONDICIONES_NO_ENVIADAS':
      return {
        tipo: 'condiciones-no-enviadas',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_CONDICIONES_NO_ENVIADAS,
      };
    case 'ESTADO_INVALIDO':
      return {
        tipo: 'estado-invalido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_ESTADO_INVALIDO,
      };
    case 'CONDICIONES_REQUERIDAS':
      return {
        tipo: 'condiciones-requeridas',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_CONDICIONES_REQUERIDAS,
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

  // Sin `codigo` reconocido: ramifica por status para no perder el 409/422.
  if (status === 409) {
    return {
      tipo: 'condiciones-no-enviadas',
      mensaje: primerMensaje(cuerpo) ?? MENSAJE_CONDICIONES_NO_ENVIADAS,
    };
  }

  if (status === 422) {
    return {
      tipo: 'estado-invalido',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha podido validar el registro de la firma.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido registrar la firma de las condiciones. Inténtalo de nuevo.',
  };
};
