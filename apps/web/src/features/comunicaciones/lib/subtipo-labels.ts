/**
 * Etiquetas humanas del `subtipo` del email E1 (change `historial-completo-comunicaciones`
 * · design.md §D-subtipo). Un mismo `codigoEmail = 'E1'` agrupa emails semánticamente
 * distintos (uno por evento del ciclo de vida); esta tabla los distingue en el listado de
 * comunicaciones de la RESERVA. Vive en `lib/` (no en `components/`) por la regla dura del
 * proyecto (`components/` solo aloja `.tsx`). Es `NULL`/`undefined` para E2–E8, `manual` y
 * filas legadas: en ese caso no se muestra etiqueta de subtipo.
 */
import type { SubtipoEmail } from '../model/types';

/** Etiqueta humana en español de cada `subtipo` de E1 (fuente: design.md §D-subtipo). */
const SUBTIPO_EMAIL_LABEL: Record<SubtipoEmail, string> = {
  consulta_exploratoria: 'Respuesta a consulta (sin fecha)',
  fecha_disponible: 'Fecha disponible / asignada',
  fecha_confirmada: 'Fecha confirmada',
  cola_espera: 'En cola de espera',
  cambio_fecha: 'Cambio de fecha',
  solicitud_datos: 'Solicitud de datos para presupuesto',
};

/**
 * Devuelve la etiqueta humana de un `subtipo`, o `null` si no lo hay (E2–E8, manual,
 * filas legadas) o si llega un valor no mapeado. El llamador oculta la etiqueta con `null`.
 */
export const etiquetaSubtipoEmail = (
  subtipo: SubtipoEmail | null | undefined,
): string | null => (subtipo ? (SUBTIPO_EMAIL_LABEL[subtipo] ?? null) : null);
