import type { components } from '@/api-client';

/**
 * Tipos del dominio Calendario (US-039). Son alias directos sobre los esquemas
 * del cliente generado (`@/api-client`): la fuente de verdad de la forma de los
 * datos es el contrato OpenAPI, nunca tipos inventados aquí.
 */
export type CalendarioFecha = components['schemas']['CalendarioFecha'];
export type CalendarioResponse = components['schemas']['CalendarioResponse'];
export type ColorCalendario = components['schemas']['ColorCalendario'];
export type VistaCalendario = components['schemas']['VistaCalendario'];

/**
 * Evento de react-big-calendar derivado de una `CalendarioFecha`. Un evento de
 * día completo por fecha ocupada; lleva el dato agregado original (`fuente`)
 * para que el popover de detalle lo reutilice sin segunda llamada (design §D-8).
 */
export type EventoCalendario = {
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  fuente: CalendarioFecha;
};
