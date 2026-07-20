/**
 * Cálculo y formateo del horario del evento (change `pdf-presupuesto-horario-idioma`,
 * Mejora 1) — helper PURO de `documentos/presentation`.
 *
 * design.md D1: `horaFin = (inicioMin + duracionHoras*60) mod 1440` reformateada a
 * "HH:MM" con cero-padding (cubre el cruce de medianoche, p. ej. 22:00 + 4h → 02:00).
 * `formatearHorario` compone el rango "De HH:MM a HH:MM (N <hores|horas>)" o, si no hay
 * hora de inicio, el fallback "(N <hores|horas>)". Arrow functions (ESLint `func-style`).
 */
import type { IdiomaDocumento } from './meses';

const MINUTOS_POR_DIA = 1440;

/** Parsea "HH:MM" a minutos desde medianoche. */
const aMinutos = (horaInicio: string): number => {
  const [horas, minutos] = horaInicio.split(':');
  return Number(horas) * 60 + Number(minutos);
};

/** Formatea unos minutos desde medianoche a "HH:MM" con cero-padding. */
const aHoraMinuto = (totalMinutos: number): string => {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
};

/**
 * Calcula la hora de fin dada la hora de inicio "HH:MM" y la duración en horas, con
 * `mod 1440` para cruzar la medianoche. Devuelve "HH:MM" con cero-padding.
 */
export const calcularHoraFin = (horaInicio: string, duracionHoras: number): string => {
  const finMinutos = (aMinutos(horaInicio) + duracionHoras * 60) % MINUTOS_POR_DIA;
  return aHoraMinuto(finMinutos);
};

/** Palabra "hores"/"horas" según el idioma (default es). */
const palabraHoras = (idioma: IdiomaDocumento): string =>
  idioma === 'ca' ? 'hores' : 'horas';

/**
 * Formatea el horario del evento: si hay hora de inicio, "De HH:MM a HH:MM (N <hores|
 * horas>)"; si `horario` es `null`, el fallback "(N <hores|horas>)" sin rango.
 */
export const formatearHorario = (
  horario: string | null,
  duracionHoras: number,
  idioma: IdiomaDocumento,
): string => {
  const sufijoDuracion = `(${duracionHoras} ${palabraHoras(idioma)})`;
  if (horario === null) {
    return sufijoDuracion;
  }
  return `De ${horario} a ${calcularHoraFin(horario, duracionHoras)} ${sufijoDuracion}`;
};
