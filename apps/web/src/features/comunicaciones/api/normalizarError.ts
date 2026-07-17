/**
 * Normalizadores de los errores del contrato de US-046 (UC-36) a uniones en español,
 * para que la UI ramifique por `tipo` (no por status). Mapean 1:1 los `codigo` de los
 * envelopes del contrato e incluyen fallback por status para no perder el desenlace si
 * el `codigo` no llega. El cliente generado no se edita a mano.
 *
 * Distinción de códigos (design.md §D-2):
 *  - `422 DESTINATARIO_INVALIDO`: no se intenta el envío; el borrador queda en `borrador`.
 *  - `409 ESTADO_NO_BORRADOR`: la fila no está en `borrador` (ya `enviado`/`fallido`).
 *  - `502 PROVEEDOR_EMAIL_FALLIDO`: se intentó y el proveedor falló; la fila queda `fallido`.
 */
import type {
  CrearEmailManualError,
  DescartarBorradorError,
  EnviarBorradorError,
  ErrorResponse,
  EstadoComunicacion,
} from '../model/types';

type CodigoError =
  | 'DESTINATARIO_INVALIDO'
  | 'ESTADO_NO_BORRADOR'
  | 'PROVEEDOR_EMAIL_FALLIDO';

type CuerpoError = ErrorResponse & {
  codigo?: CodigoError;
  estadoActual?: EstadoComunicacion;
};

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

const MSG_DESTINATARIO =
  'El cliente no tiene un email válido registrado. Actualiza el email del cliente y vuelve a intentarlo; el borrador se conserva.';
const MSG_CONFLICTO =
  'La comunicación ya no está en borrador (puede que se haya enviado o descartado). Refresca la lista.';
const MSG_PROVEEDOR =
  'El envío falló en el proveedor de email. La comunicación ha quedado como fallida; puedes reintentarlo.';

/** Normaliza el desenlace de error de "enviar borrador" (422/409/502/genérico). */
export const normalizarErrorEnviarBorrador = (
  status: number | undefined,
  error: unknown,
): EnviarBorradorError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'DESTINATARIO_INVALIDO':
      return { tipo: 'destinatario', mensaje: primerMensaje(cuerpo) ?? MSG_DESTINATARIO };
    case 'ESTADO_NO_BORRADOR':
      return {
        tipo: 'conflicto',
        mensaje: primerMensaje(cuerpo) ?? MSG_CONFLICTO,
        estadoActual: cuerpo.estadoActual,
      };
    case 'PROVEEDOR_EMAIL_FALLIDO':
      return { tipo: 'proveedor', mensaje: primerMensaje(cuerpo) ?? MSG_PROVEEDOR };
    default:
      break;
  }

  if (status === 422) return { tipo: 'destinatario', mensaje: primerMensaje(cuerpo) ?? MSG_DESTINATARIO };
  if (status === 409)
    return {
      tipo: 'conflicto',
      mensaje: primerMensaje(cuerpo) ?? MSG_CONFLICTO,
      estadoActual: cuerpo?.estadoActual,
    };
  if (status === 502 || status === 503)
    return { tipo: 'proveedor', mensaje: primerMensaje(cuerpo) ?? MSG_PROVEEDOR };

  return {
    tipo: 'generico',
    mensaje: primerMensaje(cuerpo) ?? 'No se ha podido enviar el email. Inténtalo de nuevo.',
  };
};

/** Normaliza el desenlace de error de "descartar borrador" (409/genérico). */
export const normalizarErrorDescartar = (
  status: number | undefined,
  error: unknown,
): DescartarBorradorError => {
  const cuerpo = error as CuerpoError | undefined;

  if (cuerpo?.codigo === 'ESTADO_NO_BORRADOR' || status === 409) {
    return {
      tipo: 'conflicto',
      mensaje: primerMensaje(cuerpo) ?? MSG_CONFLICTO,
      estadoActual: cuerpo?.estadoActual,
    };
  }

  return {
    tipo: 'generico',
    mensaje: primerMensaje(cuerpo) ?? 'No se ha podido descartar el borrador. Inténtalo de nuevo.',
  };
};

/** Normaliza el desenlace de error del "email manual" (422/502/genérico). */
export const normalizarErrorEmailManual = (
  status: number | undefined,
  error: unknown,
): CrearEmailManualError => {
  const cuerpo = error as CuerpoError | undefined;

  switch (cuerpo?.codigo) {
    case 'DESTINATARIO_INVALIDO':
      return { tipo: 'destinatario', mensaje: primerMensaje(cuerpo) ?? MSG_DESTINATARIO };
    case 'PROVEEDOR_EMAIL_FALLIDO':
      return { tipo: 'proveedor', mensaje: primerMensaje(cuerpo) ?? MSG_PROVEEDOR };
    default:
      break;
  }

  if (status === 422) return { tipo: 'destinatario', mensaje: primerMensaje(cuerpo) ?? MSG_DESTINATARIO };
  if (status === 502 || status === 503)
    return { tipo: 'proveedor', mensaje: primerMensaje(cuerpo) ?? MSG_PROVEEDOR };

  return {
    tipo: 'generico',
    mensaje: primerMensaje(cuerpo) ?? 'No se ha podido enviar el email. Inténtalo de nuevo.',
  };
};
