/**
 * Etiquetas legibles de la vista de cola (US-017). Solo aparecen los sub-estados
 * que una bloqueante puede tener (`2b`/`2c`/`2v`); tabla declarativa, no
 * condicionales dispersos.
 */
const SUB_ESTADO_LABEL: Record<string, string> = {
  '2b': '2.b — Con fecha',
  '2c': '2.c — Pendiente de invitados',
  '2v': '2.v — Visita programada',
};

/** Etiqueta legible del sub-estado de la bloqueante; cae al código si no mapea. */
export const etiquetaSubEstado = (subEstado?: string | null): string =>
  (subEstado && SUB_ESTADO_LABEL[subEstado]) || subEstado || '—';

/**
 * Formatea una fecha ISO `YYYY-MM-DD` (la `visitaProgramadaFecha`, tipo `date`,
 * SIN componente horario) a texto largo en español. Se ancla a mediodía UTC para
 * no arrastrar el off-by-one de zona horaria conocido en fechas de solo-día.
 */
export const formatearFechaVisita = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
