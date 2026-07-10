/**
 * Normalizador de los errores del contrato de US-036 (registro de la devolución de fianza) a la
 * unión `DevolucionFianzaError` en español. Mapea 1:1 los `codigo` del envelope de error:
 *  - 400 `IMPORTE_SUPERA_FIANZA` (FA-02): importe > fianzaEur o negativo.
 *  - 400 `FECHA_DEVOLUCION_INVALIDA` (FA-03): fecha < fianzaCobradaFecha o mal formada.
 *  - 400 `MOTIVO_RETENCION_REQUERIDO`: resultado parcial sin motivo.
 *  - 404 `JUSTIFICANTE_NO_ENCONTRADO`: el `justificanteDocId` no existe en el tenant.
 *  - 409 `PRECONDICION_NO_CUMPLIDA`: estado≠post_evento / fianza≠cobrada / sin IBAN.
 *  - 409 `DEVOLUCION_YA_REGISTRADA`: doble registro sobre estado final irreversible.
 * Incluye fallback por status para no perder el desenlace si el `codigo` no llega.
 */
import type { DevolucionFianzaError, ErrorResponse } from '../model/types';

type CodigoError =
  | 'IMPORTE_SUPERA_FIANZA'
  | 'FECHA_DEVOLUCION_INVALIDA'
  | 'MOTIVO_RETENCION_REQUERIDO'
  | 'JUSTIFICANTE_NO_ENCONTRADO'
  | 'PRECONDICION_NO_CUMPLIDA'
  | 'DEVOLUCION_YA_REGISTRADA';

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
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión `DevolucionFianzaError`.
 * `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorDevolucionFianza = (
  status: number | undefined,
  error: unknown,
): DevolucionFianzaError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'IMPORTE_SUPERA_FIANZA':
      return {
        tipo: 'importe-supera-fianza',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'El importe a devolver no puede superar la fianza cobrada.',
      };
    case 'FECHA_DEVOLUCION_INVALIDA':
      return {
        tipo: 'fecha-invalida',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza.',
      };
    case 'MOTIVO_RETENCION_REQUERIDO':
      return {
        tipo: 'motivo-requerido',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'Indica el motivo de la retención para registrar una devolución parcial.',
      };
    case 'JUSTIFICANTE_NO_ENCONTRADO':
      return {
        tipo: 'justificante-no-encontrado',
        mensaje: cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'El justificante indicado no existe.',
      };
    case 'PRECONDICION_NO_CUMPLIDA':
      return {
        tipo: 'precondicion-no-cumplida',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'No se cumplen las condiciones para registrar la devolución (evento no finalizado, fianza no cobrada o IBAN sin registrar).',
      };
    case 'DEVOLUCION_YA_REGISTRADA':
      return {
        tipo: 'ya-registrada',
        mensaje:
          cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'La devolución de la fianza ya está registrada.',
      };
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el desenlace.
  if (status === 400) {
    return {
      tipo: 'importe-supera-fianza',
      mensaje: primerMensaje(cuerpo) ?? 'Revisa el importe y la fecha de la devolución.',
    };
  }
  if (status === 404) {
    return {
      tipo: 'justificante-no-encontrado',
      mensaje: primerMensaje(cuerpo) ?? 'El justificante indicado no existe.',
    };
  }
  if (status === 409) {
    return {
      tipo: 'precondicion-no-cumplida',
      mensaje: primerMensaje(cuerpo) ?? 'La devolución no puede registrarse en el estado actual.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido registrar la devolución de la fianza. Inténtalo de nuevo.',
  };
};
