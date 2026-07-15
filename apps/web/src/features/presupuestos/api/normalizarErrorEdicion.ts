/**
 * Normalizador de los errores del contrato de **edición y reenvío** de presupuesto
 * (US-015 · UC-15) a la unión `PresupuestoError` en español. Reutiliza los casos
 * comunes de US-014 (datos fiscales, tarifa no configurada, precio manual) vía
 * `normalizarErrorPresupuesto`, y AÑADE la semántica propia de esta historia:
 *  - 409 `ORIGEN_INVALIDO` (guarda de estado): la RESERVA no está en `pre_reserva`
 *    o su último PRESUPUESTO está `aceptado`/`rechazado` → `edicion-no-permitida`.
 *  - 422 `DESCUENTO_INVALIDO` → `descuento-invalido`.
 *  - 422 `DURACION_INVALIDA` → `duracion-invalida`.
 *
 * Mapea 1:1 los `codigo` del envelope; el `error` es el cuerpo tal cual lo
 * devuelve el SDK generado. No se edita el cliente generado a mano (regla dura).
 */
import { normalizarErrorPresupuesto } from './normalizarError';
import type {
  ErrorResponse,
  PresupuestoEdicionValidacionError,
  PresupuestoError,
  PresupuestoGuardaOrigenError,
} from '../model/types';

const primerMensaje = (cuerpo?: ErrorResponse): string | undefined => {
  if (!cuerpo) return undefined;
  const m = cuerpo.message;
  return Array.isArray(m) ? m.join(' ') : m;
};

/** Códigos de error propios de la edición/reenvío (US-015). */
type CodigoEdicion =
  | 'ORIGEN_INVALIDO'
  | 'DESCUENTO_INVALIDO'
  | 'DURACION_INVALIDA';

export const normalizarErrorEdicion = (
  status: number | undefined,
  error: unknown,
): PresupuestoError => {
  const cuerpo = error as (ErrorResponse & { codigo?: CodigoEdicion }) | undefined;
  const codigo = cuerpo?.codigo;

  // 409 de la guarda de estado: en edición/reenvío `ORIGEN_INVALIDO` significa que
  // la RESERVA salió de `pre_reserva` o el presupuesto ya está aceptado/rechazado.
  if (status === 409 || codigo === 'ORIGEN_INVALIDO') {
    const guarda = error as PresupuestoGuardaOrigenError;
    return {
      tipo: 'edicion-no-permitida',
      mensaje:
        guarda?.motivo ??
        primerMensaje(cuerpo) ??
        'El presupuesto ya no se puede editar: está aceptado o la reserva no está en pre-reserva.',
    };
  }

  if (codigo === 'DESCUENTO_INVALIDO') {
    const val = error as PresupuestoEdicionValidacionError;
    return {
      tipo: 'descuento-invalido',
      mensaje:
        primerMensaje(val) ??
        'El descuento no es válido: debe ser 0 o superior y no puede superar la base imponible.',
    };
  }

  if (codigo === 'DURACION_INVALIDA') {
    const val = error as PresupuestoEdicionValidacionError;
    return {
      tipo: 'duracion-invalida',
      mensaje: primerMensaje(val) ?? 'La duración del evento debe ser 4, 8 o 12 horas.',
    };
  }

  // El resto de códigos (datos fiscales, tarifa, precio manual) son idénticos a US-014.
  return normalizarErrorPresupuesto(status, error);
};
