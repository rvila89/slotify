/**
 * Constantes y helpers puros del flujo de EDICIÓN del presupuesto (US-015 · UC-15).
 * Sin JSX: viven en `lib/` por la regla dura "components/ solo .tsx". Reutilizan los
 * tokens y estilos del proyecto (`estilos.ts`) para no duplicar cadenas de clases.
 */
import type { DuracionHorasEdicion } from '../model/types';

/** Duraciones admitidas por la edición (recalculan la tarifa vía motor US-016). */
export const DURACIONES_HORAS: readonly DuracionHorasEdicion[] = [4, 8, 12] as const;

/** Etiqueta legible de una duración de evento. */
export const etiquetaDuracion = (horas: DuracionHorasEdicion): string => `${horas} horas`;

/**
 * Acota una duración de la RESERVA (posiblemente `null`/fuera de enum) al valor del
 * <select> de edición. Devuelve el string del enum {'4','8','12'}; fallback `'4'`
 * cuando el valor no pertenece al enum o es nulo (D3, mejora US-015). Vive en `lib/`
 * (helper puro, no componente) por la regla dura "components/ solo .tsx".
 */
export const acotarDuracionInicial = (
  duracion: number | null | undefined,
): '4' | '8' | '12' =>
  duracion != null && DURACIONES_HORAS.includes(duracion as DuracionHorasEdicion)
    ? (String(duracion) as '4' | '8' | '12')
    : '4';

export const MENSAJE_INVITADOS_INVALIDO = 'Introduce un número de invitados válido (1 o superior)';
export const MENSAJE_DESCUENTO_INVALIDO = 'El descuento debe ser 0 o superior';
export const MENSAJE_PRECIO_MANUAL_NO_NEGATIVO = 'Introduce un importe válido (0 o superior)';
