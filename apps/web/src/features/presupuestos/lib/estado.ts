/**
 * Guardas de cliente para la acción "Generar presupuesto" (US-014 · UC-14). Espejo
 * de la guarda de origen declarativa del backend: solo se ofrece sobre una RESERVA
 * en `estado='consulta'` con `subEstado ∈ {2a,2b,2c,2v}` y sin PRESUPUESTO
 * `enviado`/`aceptado` previo. El origen `2d` (cola), los terminales (`2x`/`2y`/`2z`)
 * y `pre_reserva`+ quedan fuera. Es solo para habilitar/deshabilitar y explicar en
 * la UI; el servidor revalida de forma defensiva (409/422).
 */
import type { CampoFiscalFaltante } from '../model/types';

/** Sub-estados de consulta que son origen válido para generar presupuesto. */
const SUB_ESTADOS_ORIGEN_VALIDO = ['2a', '2b', '2c', '2v'] as const;

type ReservaGuarda = {
  estado?: string;
  subEstado?: string | null;
};

/**
 * Indica si la RESERVA es un origen válido de estado para "Generar presupuesto".
 * NO comprueba datos fiscales ni presupuesto existente (eso lo revalida el
 * backend con su desenlace específico); solo la guarda de sub-estado, que es lo
 * que decide si el botón aparece habilitado o deshabilitado en la ficha.
 */
export const puedeGenerarPresupuesto = (reserva: ReservaGuarda): boolean =>
  reserva.estado === 'consulta' &&
  SUB_ESTADOS_ORIGEN_VALIDO.includes(
    reserva.subEstado as (typeof SUB_ESTADOS_ORIGEN_VALIDO)[number],
  );

/**
 * Explica por qué NO se puede generar el presupuesto, para el texto de la ficha
 * cuando el botón queda deshabilitado (2d/terminales/pre_reserva+).
 */
export const motivoNoPuedeGenerar = (reserva: ReservaGuarda): string => {
  if (reserva.estado !== 'consulta') {
    return 'Esta reserva ya ha superado la fase de consulta; el presupuesto no puede regenerarse desde aquí.';
  }
  if (reserva.subEstado === '2d') {
    return 'Esta consulta está en cola de espera. Debe promoverse a bloqueante antes de generar un presupuesto (UC-12).';
  }
  return 'Esta consulta está en un estado terminal y no admite la generación de un presupuesto.';
};

/** Etiquetas legibles en español de cada campo fiscal/de reserva faltante (FA-01). */
export const ETIQUETA_CAMPO_FALTANTE: Record<CampoFiscalFaltante, string> = {
  dniNif: 'DNI / NIF del cliente',
  direccion: 'Dirección del cliente',
  codigoPostal: 'Código postal del cliente',
  poblacion: 'Población del cliente',
  provincia: 'Provincia del cliente',
  fechaEvento: 'Fecha del evento',
  duracionHoras: 'Duración (horas)',
  numAdultosNinosMayores4: 'Número de invitados (adultos y niños > 4 años)',
  tipoEvento: 'Tipo de evento',
};
