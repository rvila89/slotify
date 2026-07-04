/**
 * Normalizador de los errores del contrato de facturación (US-022) a la unión
 * `FacturaError` en español. Mapea 1:1 los `codigo` del envelope de error:
 *  - 409 `FACTURA_NO_BORRADOR` (`FacturaEstadoInvalidoError`).
 *  - 422 `DATOS_FISCALES_INCOMPLETOS` (`FacturaDatosFiscalesIncompletosError`,
 *    con `camposFaltantes`) / `PDF_PENDIENTE` (`FacturaPdfPendienteError`).
 *  - 400 (rechazo sin motivo válido).
 * Incluye fallback por status para no perder el 409/422/400 si el `codigo` no llega.
 */
import type {
  CampoFiscalFaltante,
  ErrorResponse,
  FacturaError,
} from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error del contrato de US-022 (409 conflicto + 422 guardas). */
type CodigoError = 'FACTURA_NO_BORRADOR' | 'DATOS_FISCALES_INCOMPLETOS' | 'PDF_PENDIENTE';

type CuerpoError = ErrorResponse & {
  codigo?: CodigoError;
  motivo?: string;
  camposFaltantes?: CampoFiscalFaltante[];
};

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `FacturaError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorFactura = (
  status: number | undefined,
  error: unknown,
): FacturaError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'FACTURA_NO_BORRADOR':
      return {
        tipo: 'factura-no-borrador',
        mensaje: cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'La factura no está en borrador',
      };
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
        mensaje: cuerpo.motivo ?? primerMensaje(cuerpo) ?? 'PDF pendiente de regenerar',
      };
    default:
      break;
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el desenlace.
  if (status === 409) {
    return {
      tipo: 'factura-no-borrador',
      mensaje: primerMensaje(cuerpo) ?? 'La factura ya no está en borrador.',
    };
  }

  if (status === 422) {
    return {
      tipo: 'pdf-pendiente',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha podido completar la operación sobre la factura.',
    };
  }

  if (status === 400) {
    return {
      tipo: 'motivo-requerido',
      mensaje: primerMensaje(cuerpo) ?? 'Indica el motivo del rechazo.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido completar la operación. Inténtalo de nuevo.',
  };
};
