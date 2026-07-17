/**
 * Guardas de disponibilidad de la vista de documentación del evento (US-033),
 * espejo de la guarda de precondición del backend (design.md §D-no-transicion):
 *  - la **subida** solo se admite en `evento_en_curso`;
 *  - el **checklist** se consulta también en `post_evento` (para mostrar pendientes
 *    tras finalizar, coherente con FA-01), en modo lectura.
 * La validación autoritativa es la del servidor (422 ESTADO_NO_PERMITE_DOCUMENTACION).
 */

/** Estado de la reserva en el que se permite SUBIR documentación del evento. */
export const permiteSubirDocumentacion = (estado: string | null | undefined): boolean =>
  estado === 'evento_en_curso';

/**
 * Estados en los que la sección de documentación del evento es visible en la ficha:
 * `evento_en_curso` (subida + checklist) y `post_evento` (checklist en lectura).
 */
export const debeMostrarSeccionDocumentacion = (estado: string | null | undefined): boolean =>
  estado === 'evento_en_curso' || estado === 'post_evento';
