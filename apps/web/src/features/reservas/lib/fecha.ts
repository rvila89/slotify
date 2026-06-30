/**
 * Helpers de fecha compartidos por el dominio de reservas (US-004 alta y US-005
 * transición). Las fechas en formato `YYYY-MM-DD` comparan lexicográficamente
 * == cronológicamente, lo que evita problemas de zona horaria al validar
 * "estrictamente futura" (regla de fecha unificada del proyecto, `> hoy`).
 */
/**
 * Días máximos por defecto para programar una visita (US-008). Espejo del default
 * de `TENANT_SETTINGS.max_dias_programar_visita` (7). El servidor es la fuente de
 * verdad de la ventana (responde 422 fuera de rango); este valor solo acota el
 * picker en cliente para el caso feliz mientras el setting no se exponga por API.
 */
export const MAX_DIAS_PROGRAMAR_VISITA_DEFAULT = 7;

const aISODate = (d: Date): string => {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/** Hoy en formato ISO `YYYY-MM-DD` (zona local). */
export const hoyISO = (): string => aISODate(new Date());

/**
 * Mañana en ISO. Es el `min` del selector de fecha: bloquea HOY y días
 * pasados, dejando solo fechas estrictamente futuras (D-1, decisión humana
 * aprobada `> hoy`).
 */
export const mananaISO = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return aISODate(d);
};

/**
 * Hoy + `dias` días en ISO `YYYY-MM-DD`. Es el `max` del selector de la fecha
 * de visita (US-008): la visita debe programarse dentro de la ventana
 * `[hoy + 1, hoy + TENANT_SETTINGS.max_dias_programar_visita]`. El servidor es
 * la fuente de verdad de la ventana (responde 422 si la fecha cae fuera); este
 * límite de cliente solo acota el picker para el caso feliz.
 */
export const hoyMasDiasISO = (dias: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return aISODate(d);
};

/** Formatea una fecha ISO `YYYY-MM-DD` a texto largo en español. */
export const formatearFecha = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** Formatea una fecha-hora ISO (date-time) a fecha larga en español. */
export const formatearFechaHora = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/**
 * Indica si un bloqueo de fecha sigue vigente: hay `ttlExpiracion` y es posterior
 * a ahora. Gate de la acción "Marcar como pendiente de invitados" (US-007 · D-1):
 * solo aplica a consultas en `2.b` con bloqueo vigente. El servidor revalida de
 * forma defensiva (409 BloqueoNoVigenteError), por lo que esta comprobación de
 * cliente es solo para habilitar/deshabilitar la acción, no la fuente de verdad.
 */
export const bloqueoVigente = (ttlExpiracion?: string | null): boolean => {
  if (!ttlExpiracion) return false;
  const expira = new Date(ttlExpiracion).getTime();
  return Number.isFinite(expira) && expira > Date.now();
};
