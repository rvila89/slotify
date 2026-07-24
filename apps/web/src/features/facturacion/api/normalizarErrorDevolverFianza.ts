/**
 * Normalizador de los errores del contrato de la **devolución de fianza** (devolución
 * completa, sin IBAN ni retención) a la unión `DevolucionFianzaError` en español. Mapea 1:1
 * los `codigo` del envelope `DevolucionFianzaError` (409), con fallback por status.
 */
import type { DevolucionFianzaError, ErrorResponse } from '../model/types';

type CodigoError = 'PRECONDICION_NO_CUMPLIDA' | 'DEVOLUCION_YA_REGISTRADA';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `DevolucionFianzaError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorDevolverFianza = (
  status: number | undefined,
  error: unknown,
): DevolucionFianzaError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError; motivo?: string }) | undefined;

  switch (cuerpo?.codigo) {
    case 'PRECONDICION_NO_CUMPLIDA':
      return {
        tipo: 'precondicion-no-cumplida',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'No se cumplen las condiciones para devolver la fianza (la reserva debe estar en post-evento con la fianza recibida).',
      };
    case 'DEVOLUCION_YA_REGISTRADA':
      return {
        tipo: 'ya-registrada',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'La devolución de la fianza ya está registrada.',
      };
    default:
      break;
  }

  if (status === 409) {
    return {
      tipo: 'precondicion-no-cumplida',
      mensaje:
        primerMensaje(cuerpo) ??
        'No se cumplen las condiciones para devolver la fianza.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido registrar la devolución de la fianza. Inténtalo de nuevo.',
  };
};
