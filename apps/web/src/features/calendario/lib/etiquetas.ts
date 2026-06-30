import type { CalendarioFecha } from '../model/types';

/**
 * Etiquetas legibles de sub-estado de consulta (US-039 §Clic en fecha: el
 * popover muestra "2.b — Con fecha"). Tabla declarativa; solo aparecen los
 * sub-estados que ocupan fecha (los terminales 2x/2y/2z no llegan a esta vista).
 */
const SUB_ESTADO_LABEL: Record<string, string> = {
  '2a': '2.a — Exploratoria',
  '2b': '2.b — Con fecha',
  '2c': '2.c — Pendiente de invitados',
  '2d': '2.d — En cola',
  '2v': '2.v — Visita programada',
};

/** Etiquetas legibles del estado de reserva, para fechas sin sub-estado. */
const ESTADO_LABEL: Record<string, string> = {
  consulta: 'Consulta',
  pre_reserva: 'Pre-reserva',
  reserva_confirmada: 'Reserva confirmada',
  evento_en_curso: 'Evento en curso',
  post_evento: 'Post-evento',
  reserva_completada: 'Reserva completada',
  reserva_cancelada: 'Reserva cancelada',
};

/**
 * Etiqueta de estado para el popover: prioriza el sub-estado (más específico)
 * y cae al estado principal cuando no hay sub-estado (firme/histórica).
 */
export const etiquetaEstado = (fecha: CalendarioFecha): string => {
  if (fecha.subEstado && SUB_ESTADO_LABEL[fecha.subEstado]) {
    return SUB_ESTADO_LABEL[fecha.subEstado];
  }
  return ESTADO_LABEL[fecha.estado] ?? fecha.estado;
};
