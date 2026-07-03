/**
 * Normalizador de los errores del contrato de confirmación de señal (US-021) a la
 * unión `ConfirmarSenalError` en español. Mapea 1:1 los `codigo` del envelope de
 * error (422 `ConfirmarSenalValidacionError` / 409 `ConfirmarSenalConflictoError`),
 * con los mensajes literales de la spec-delta, y con fallback por status para no
 * perder el 409/422 si el `codigo` no llega.
 */
import {
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_JUSTIFICANTE_REQUERIDO,
  MENSAJE_TAMANO_EXCEDIDO,
} from '../lib/justificante';
import type {
  ConfirmarSenalConflictoError,
  ConfirmarSenalError,
  ErrorResponse,
} from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error del contrato de US-021 (422 validación + 409 conflicto). */
type CodigoError =
  | 'ORIGEN_INVALIDO'
  | 'JUSTIFICANTE_REQUERIDO'
  | 'FORMATO_NO_PERMITIDO'
  | 'TAMANO_EXCEDIDO'
  | 'IMPORTE_TOTAL_INVALIDO'
  | 'RESERVA_YA_CONFIRMADA'
  | 'FECHA_NO_DISPONIBLE';

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `ConfirmarSenalError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorConfirmarSenal = (
  status: number | undefined,
  error: unknown,
): ConfirmarSenalError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError; motivo?: string }) | undefined;
  const codigo = cuerpo?.codigo;

  switch (codigo) {
    case 'ORIGEN_INVALIDO':
      return {
        tipo: 'origen-invalido',
        mensaje: primerMensaje(cuerpo) ?? 'La reserva no está en estado pre_reserva',
      };
    case 'JUSTIFICANTE_REQUERIDO':
      return {
        tipo: 'justificante-requerido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_JUSTIFICANTE_REQUERIDO,
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
    case 'IMPORTE_TOTAL_INVALIDO':
      return {
        tipo: 'importe-invalido',
        mensaje:
          primerMensaje(cuerpo) ??
          'La reserva no tiene un importe total válido; no hay un presupuesto aceptado previo.',
      };
    case 'RESERVA_YA_CONFIRMADA': {
      const conflicto = error as ConfirmarSenalConflictoError;
      return {
        tipo: 'reserva-ya-confirmada',
        mensaje: conflicto.motivo ?? 'La reserva ya ha sido confirmada',
      };
    }
    case 'FECHA_NO_DISPONIBLE': {
      const conflicto = error as ConfirmarSenalConflictoError;
      return {
        tipo: 'fecha-no-disponible',
        mensaje: conflicto.motivo ?? 'Fecha no disponible',
      };
    }
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el 409/422.
  if (status === 409) {
    return {
      tipo: 'reserva-ya-confirmada',
      mensaje:
        primerMensaje(cuerpo) ?? 'La operación no se pudo completar por un conflicto de estado.',
    };
  }

  if (status === 422) {
    return {
      tipo: 'origen-invalido',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha podido validar la confirmación de la señal.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido confirmar el pago de la señal. Inténtalo de nuevo.',
  };
};
