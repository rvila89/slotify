import type { CalendarioFecha, EventoCalendario } from '../model/types';
import { desdeISODate } from './fecha';

/**
 * Transforma las fechas ocupadas del backend en eventos de día completo para
 * react-big-calendar. Cada entrada de `fechas` (una por fecha ocupada, design
 * §D-1) produce un evento; el dato agregado original viaja en `fuente` para que
 * el popover de detalle lo reutilice SIN segunda llamada (design §D-8).
 */
export const aEventos = (fechas: CalendarioFecha[]): EventoCalendario[] =>
  fechas.map((fecha) => {
    const dia = desdeISODate(fecha.fecha);
    return {
      title: fecha.cliente,
      start: dia,
      end: dia,
      allDay: true,
      fuente: fecha,
    };
  });
