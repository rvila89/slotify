import { dateFnsLocalizer, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import type { VistaCalendario } from '../model/types';

/**
 * Localizador de react-big-calendar en español (date-fns + locale `es`). La
 * semana empieza en lunes (`weekStartsOn: 1`), convención ES.
 */
export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

export const culture = 'es';

/** Textos de la UI de react-big-calendar en español. */
export const mensajes = {
  date: 'Fecha',
  time: 'Hora',
  event: 'Reserva',
  allDay: 'Todo el día',
  week: 'Semana',
  work_week: 'Semana laboral',
  day: 'Día',
  month: 'Mes',
  previous: 'Anterior',
  next: 'Siguiente',
  yesterday: 'Ayer',
  tomorrow: 'Mañana',
  today: 'Hoy',
  agenda: 'Lista',
  noEventsInRange: 'No hay fechas ocupadas en este período.',
  showMore: (total: number) => `+${total} más`,
};

/**
 * Puente entre la `vista` del contrato (`mes|semana|dia|lista`) y las vistas de
 * react-big-calendar (`month|week|day|agenda`). Tablas declarativas en ambos
 * sentidos para mantener una única fuente de verdad de la correspondencia.
 */
export const VISTA_A_RBC: Record<VistaCalendario, View> = {
  mes: 'month',
  semana: 'week',
  dia: 'day',
  lista: 'agenda',
};

export const RBC_A_VISTA: Record<string, VistaCalendario> = {
  month: 'mes',
  week: 'semana',
  day: 'dia',
  agenda: 'lista',
};
