/**
 * Normalizador de los errores del contrato de US-030 (registro del cobro de fianza) a la
 * unión `CobroFianzaError` en español. Mapea 1:1 los `codigo` del envelope de error:
 *  - 409 `FIANZA_YA_COBRADA`: doble cobro; la fianza ya está `cobrada`.
 *  - 400 `COBRO_INVALIDO`: `importe <= 0` o `fechaCobro` posterior al evento / mal formada.
 *  - 404 `FACTURA_FIANZA_NO_ENCONTRADA` / `JUSTIFICANTE_NO_ENCONTRADO`.
 * Incluye fallback por status para no perder el desenlace si el `codigo` no llega.
 * NOTA: la política "Negociable" (`fianzaStatus='pendiente'`) NO es un error: llega como
 * respuesta 200 `confirmacion_requerida` y se resuelve en el hook/diálogo, no aquí.
 */
import type { CobroFianzaError, ErrorResponse } from '../model/types';

type CodigoError =
  | 'FIANZA_YA_COBRADA'
  | 'COBRO_INVALIDO'
  | 'FACTURA_FIANZA_NO_ENCONTRADA'
  | 'JUSTIFICANTE_NO_ENCONTRADO';

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
 * `CobroFianzaError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorCobroFianza = (
  status: number | undefined,
  error: unknown,
): CobroFianzaError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'FIANZA_YA_COBRADA':
      return {
        tipo: 'ya-cobrada',
        mensaje: cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'La fianza ya está marcada como cobrada.',
      };
    case 'COBRO_INVALIDO':
      return {
        tipo: 'cobro-invalido',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'El importe debe ser mayor que cero y la fecha de cobro no puede ser posterior al evento.',
      };
    case 'FACTURA_FIANZA_NO_ENCONTRADA':
      return {
        tipo: 'factura-no-encontrada',
        mensaje:
          cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'No se ha encontrado el recibo de fianza de la reserva.',
      };
    case 'JUSTIFICANTE_NO_ENCONTRADO':
      return {
        tipo: 'justificante-no-encontrado',
        mensaje:
          cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'El justificante indicado no existe.',
      };
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el desenlace.
  if (status === 409) {
    return { tipo: 'ya-cobrada', mensaje: primerMensaje(cuerpo) ?? 'La fianza ya está marcada como cobrada.' };
  }
  if (status === 400) {
    return {
      tipo: 'cobro-invalido',
      mensaje:
        primerMensaje(cuerpo) ??
        'El importe debe ser mayor que cero y la fecha de cobro no puede ser posterior al evento.',
    };
  }
  if (status === 404) {
    return {
      tipo: 'factura-no-encontrada',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha encontrado el recibo de fianza de la reserva.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido registrar el cobro de la fianza. Inténtalo de nuevo.',
  };
};
