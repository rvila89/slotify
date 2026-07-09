/**
 * Reglas de cliente de la acción "Marcar evento como finalizado" (US-034 · UC-25).
 * Espejo de la guarda de origen declarativa del backend (`evento_en_curso →
 * post_evento`): la acción SOLO está disponible cuando `RESERVA.estado =
 * evento_en_curso`; en cualquier otro estado no se ofrece. El servidor revalida de
 * forma defensiva (409 `transicion_no_permitida`).
 *
 * También traduce las claves crudas del checklist de documentación pendiente
 * (superficie de US-033, p. ej. `dni_anverso`, `clausula_responsabilidad`) a
 * etiquetas legibles en español para la advertencia NO bloqueante. Si llega una
 * clave desconocida (fail-open: el catálogo lo posee US-033), se muestra la clave
 * normalizada sin romper.
 */
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];

/** La acción "Finalizar evento" solo aplica en `evento_en_curso`. */
export const puedeFinalizarEvento = (estado: EstadoReserva | undefined): boolean =>
  estado === 'evento_en_curso';

/** Etiquetas conocidas del checklist de documentación del evento (US-033). */
const ETIQUETA_DOCUMENTACION: Record<string, string> = {
  dni_anverso: 'DNI (anverso)',
  dni_reverso: 'DNI (reverso)',
  clausula_responsabilidad: 'Cláusula de responsabilidad',
};

/**
 * Convierte una clave cruda de documentación pendiente en una etiqueta legible.
 * Fail-open: si la clave no está en el catálogo conocido, se normaliza
 * (`snake_case` → "Snake case") en lugar de fallar.
 */
export const etiquetaDocumentacionPendiente = (clave: string): string =>
  ETIQUETA_DOCUMENTACION[clave] ??
  clave
    .replace(/[_-]+/g, ' ')
    .replace(/^\s*(.)/, (_m, primera: string) => primera.toUpperCase())
    .trim();
