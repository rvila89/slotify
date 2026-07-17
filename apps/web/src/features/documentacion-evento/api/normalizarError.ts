/**
 * Normalizador de los errores del contrato de subida de documentación del evento
 * (US-033) a la unión `SubirDocumentoEventoError` en español. Mapea 1:1 los
 * `codigo` del envelope de error (422 `SubirDocumentoEventoValidacionError`), con
 * los mensajes literales de la spec-delta, y con fallback por status para no perder
 * el 404/422 si el `codigo` no llega.
 */
import {
  MENSAJE_ARCHIVO_INVALIDO,
  MENSAJE_ARCHIVO_REQUERIDO,
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_TAMANO_EXCEDIDO,
} from '../lib/fichero';
import type { ErrorResponse, SubirDocumentoEventoError } from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error del contrato de US-033 (422 validación de negocio/fichero). */
type CodigoError =
  | 'ESTADO_NO_PERMITE_DOCUMENTACION'
  | 'TIPO_DOCUMENTO_NO_PERMITIDO'
  | 'ARCHIVO_REQUERIDO'
  | 'FORMATO_NO_PERMITIDO'
  | 'ARCHIVO_INVALIDO'
  | 'TAMANO_EXCEDIDO';

const MENSAJE_ESTADO_NO_PERMITE =
  'La documentación del evento solo puede capturarse mientras el evento está en curso.';

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `SubirDocumentoEventoError`. `error` es el cuerpo tal cual lo devuelve el SDK.
 */
export const normalizarErrorSubirDocumento = (
  status: number | undefined,
  error: unknown,
): SubirDocumentoEventoError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError }) | undefined;
  const codigo = cuerpo?.codigo;

  switch (codigo) {
    case 'ESTADO_NO_PERMITE_DOCUMENTACION':
      return {
        tipo: 'estado-no-permite',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_ESTADO_NO_PERMITE,
      };
    case 'TIPO_DOCUMENTO_NO_PERMITIDO':
      return {
        tipo: 'tipo-no-permitido',
        mensaje: primerMensaje(cuerpo) ?? 'El tipo de documento no está permitido.',
      };
    case 'ARCHIVO_REQUERIDO':
      return {
        tipo: 'archivo-requerido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_ARCHIVO_REQUERIDO,
      };
    case 'FORMATO_NO_PERMITIDO':
      return {
        tipo: 'formato-no-permitido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_FORMATO_NO_PERMITIDO,
      };
    case 'ARCHIVO_INVALIDO':
      return {
        tipo: 'archivo-invalido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_ARCHIVO_INVALIDO,
      };
    case 'TAMANO_EXCEDIDO':
      return {
        tipo: 'tamano-excedido',
        mensaje: primerMensaje(cuerpo) ?? MENSAJE_TAMANO_EXCEDIDO,
      };
    default:
      break;
  }

  if (status === 404) {
    return {
      tipo: 'no-encontrada',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha encontrado la reserva.',
    };
  }

  if (status === 422) {
    return {
      tipo: 'estado-no-permite',
      mensaje: primerMensaje(cuerpo) ?? 'No se ha podido validar la subida del documento.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido subir el documento. Inténtalo de nuevo.',
  };
};
