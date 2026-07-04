/**
 * Normalizador de los errores del contrato de US-028 (emisión con envío) a la unión
 * `LiquidacionError` en español. Mapea 1:1 los `codigo` del envelope de error:
 *  - 409 `FACTURA_NO_BORRADOR` (`FacturaEstadoInvalidoError`): en aprobar-y-enviar y
 *    en enviar-fianza-separado significa "ya no está en borrador"; en reenviar
 *    significa "aún no está enviada" (se distingue por `contexto`).
 *  - 422 `DATOS_FISCALES_INCOMPLETOS` (con `camposFaltantes`) / `PDF_PENDIENTE` /
 *    `DESCUENTO_INVALIDO`.
 *  - 502 / 503 `EMISION_ENVIO_FALLIDO`: fallo RECUPERABLE (rollback total, reintentable).
 * Incluye fallback por status para no perder el desenlace si el `codigo` no llega.
 */
import type {
  CampoFiscalFaltante,
  ErrorResponse,
  LiquidacionError,
} from '../model/types';

/** Contexto de la mutación, para desambiguar el 409 (no-borrador vs. no-enviada). */
export type ContextoLiquidacion = 'aprobar-enviar' | 'enviar-fianza' | 'reenviar';

type CodigoError =
  | 'FACTURA_NO_BORRADOR'
  | 'DATOS_FISCALES_INCOMPLETOS'
  | 'PDF_PENDIENTE'
  | 'DESCUENTO_INVALIDO'
  | 'EMISION_ENVIO_FALLIDO';

type CuerpoError = ErrorResponse & {
  codigo?: CodigoError;
  motivo?: string;
  camposFaltantes?: CampoFiscalFaltante[];
  reintentable?: boolean;
};

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** El 409 significa distinto según la acción del Gestor. */
const conflictoEstado = (
  contexto: ContextoLiquidacion,
  mensaje: string | undefined,
): LiquidacionError =>
  contexto === 'reenviar'
    ? {
        tipo: 'no-enviada',
        mensaje:
          mensaje ??
          'La factura de liquidación aún no se ha emitido. Apruébala y envíala primero.',
      }
    : {
        tipo: 'factura-no-borrador',
        mensaje: mensaje ?? 'La factura ya no está en borrador.',
      };

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `LiquidacionError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorLiquidacion = (
  status: number | undefined,
  error: unknown,
  contexto: ContextoLiquidacion,
): LiquidacionError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'FACTURA_NO_BORRADOR':
      return conflictoEstado(contexto, cuerpo.motivo ?? primerMensaje(cuerpo));
    case 'DATOS_FISCALES_INCOMPLETOS':
      return {
        tipo: 'datos-fiscales-incompletos',
        mensaje:
          primerMensaje(cuerpo) ??
          'Faltan datos fiscales del cliente para emitir la factura.',
        camposFaltantes: cuerpo.camposFaltantes ?? [],
      };
    case 'PDF_PENDIENTE':
      return {
        tipo: 'pdf-pendiente',
        mensaje: cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'PDF pendiente de regenerar.',
      };
    case 'DESCUENTO_INVALIDO':
      return {
        tipo: 'descuento-invalido',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'El descuento no puede ser negativo ni dejar el total en cero.',
      };
    case 'EMISION_ENVIO_FALLIDO':
      return {
        tipo: 'emision-envio-fallido',
        mensaje:
          cuerpo.motivo ??
          primerMensaje(cuerpo) ??
          'No se pudo generar el PDF o enviar el email. Nada ha cambiado; inténtalo de nuevo.',
        reintentable: cuerpo.reintentable ?? true,
      };
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el desenlace.
  if (status === 409) {
    return conflictoEstado(contexto, primerMensaje(cuerpo));
  }

  if (status === 422) {
    return {
      tipo: 'pdf-pendiente',
      mensaje:
        primerMensaje(cuerpo) ?? 'No se ha podido completar la operación sobre la factura.',
    };
  }

  if (status === 502 || status === 503) {
    return {
      tipo: 'emision-envio-fallido',
      mensaje:
        primerMensaje(cuerpo) ??
        'No se pudo generar el PDF o enviar el email. Nada ha cambiado; inténtalo de nuevo.',
      reintentable: true,
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido completar la operación. Inténtalo de nuevo.',
  };
};
