/**
 * Normalizador común de los errores del contrato de presupuestos (US-014) a la
 * unión `PresupuestoError` en español. Compartido por las mutaciones de preview y
 * de confirmación, que exponen exactamente los mismos códigos de dominio (con la
 * salvedad de que `FECHA_NO_DISPONIBLE` y `PRECIO_MANUAL_REQUERIDO` solo aparecen
 * al confirmar). Mapea 1:1 los `codigo` del envelope de error, con fallback al
 * `message` genérico del `ErrorResponse` y, en último término, a un texto neutro.
 */
import type {
  ErrorResponse,
  PresupuestoDatosFiscalesError,
  PresupuestoError,
  PresupuestoGuardaOrigenError,
} from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error del contrato de US-014 (más los del motor de tarifa US-016). */
type CodigoError =
  | 'DATOS_FISCALES_INCOMPLETOS'
  | 'PRECIO_MANUAL_REQUERIDO'
  | 'TARIFA_NO_CONFIGURADA'
  | 'TEMPORADA_NO_CONFIGURADA'
  | 'ORIGEN_INVALIDO'
  | 'PRESUPUESTO_YA_EXISTE'
  | 'FECHA_NO_DISPONIBLE';

/**
 * Traduce un desenlace de error (status + cuerpo del envelope) a la unión
 * `PresupuestoError`. `error` es el cuerpo tal cual lo devuelve el SDK generado.
 */
export const normalizarErrorPresupuesto = (
  status: number | undefined,
  error: unknown,
): PresupuestoError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoError }) | undefined;
  const codigo = cuerpo?.codigo;

  if (codigo === 'DATOS_FISCALES_INCOMPLETOS') {
    const fiscal = error as PresupuestoDatosFiscalesError;
    return {
      tipo: 'datos-fiscales',
      camposFaltantes: fiscal.camposFaltantes ?? [],
      mensaje:
        primerMensaje(fiscal) ??
        'Faltan datos fiscales o de la reserva para poder generar el presupuesto.',
    };
  }

  if (codigo === 'TARIFA_NO_CONFIGURADA' || codigo === 'TEMPORADA_NO_CONFIGURADA') {
    return {
      tipo: 'tarifa-no-configurada',
      mensaje:
        primerMensaje(cuerpo) ??
        'No hay una tarifa configurada para esta combinación de temporada, duración e invitados. Revisa el tarifario.',
    };
  }

  if (codigo === 'PRECIO_MANUAL_REQUERIDO') {
    return {
      tipo: 'precio-manual-requerido',
      mensaje:
        primerMensaje(cuerpo) ??
        'Introduce el precio manual: esta consulta supera los 50 invitados (tarifa a consultar).',
    };
  }

  if (codigo === 'FECHA_NO_DISPONIBLE') {
    const guarda = error as PresupuestoGuardaOrigenError;
    return {
      tipo: 'fecha-no-disponible',
      mensaje: guarda.motivo ?? 'Fecha no disponible.',
    };
  }

  if (codigo === 'PRESUPUESTO_YA_EXISTE') {
    const guarda = error as PresupuestoGuardaOrigenError;
    return {
      tipo: 'presupuesto-ya-existe',
      mensaje:
        guarda.motivo ??
        'Ya existe un presupuesto enviado o aceptado para esta reserva. Usa la edición del presupuesto (UC-15).',
    };
  }

  if (codigo === 'ORIGEN_INVALIDO') {
    const guarda = error as PresupuestoGuardaOrigenError;
    return {
      tipo: 'origen-invalido',
      mensaje:
        guarda.motivo ??
        'Esta consulta ya no está en un estado que permita generar un presupuesto.',
    };
  }

  // Sin `codigo` reconocido: ramifica por status para no perder el 409/422.
  if (status === 409) {
    return {
      tipo: 'fecha-no-disponible',
      mensaje:
        primerMensaje(cuerpo) ?? 'La operación no se pudo completar por un conflicto de estado.',
    };
  }

  if (status === 422) {
    return {
      tipo: 'origen-invalido',
      mensaje: primerMensaje(cuerpo) ?? 'La validación del presupuesto no se pudo completar.',
    };
  }

  return {
    tipo: 'generico',
    mensaje: 'No se ha podido completar la acción. Inténtalo de nuevo.',
  };
};
