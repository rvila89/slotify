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

/**
 * Campos de la RESERVA que deben estar completos para poder presupuestar
 * (US-051 §Punto 3). Es un subconjunto de datos del evento, no de datos
 * fiscales del CLIENTE (esos siguen su propio flujo). El orden del array fija la
 * enumeración estable que muestra la ficha.
 */
export type CampoCompletitudPresupuesto =
  | 'fechaEvento'
  | 'numAdultosNinosMayores4'
  | 'duracionHoras'
  | 'horario';

/** Etiquetas legibles en español de cada dato de completitud para presupuestar. */
export const ETIQUETA_CAMPO_COMPLETITUD: Record<CampoCompletitudPresupuesto, string> = {
  fechaEvento: 'Fecha del evento',
  numAdultosNinosMayores4: 'Número de invitados',
  duracionHoras: 'Duración (horas)',
  horario: 'Hora de inicio',
};

type ReservaGuarda = {
  estado?: string;
  subEstado?: string | null;
};

type ReservaCompletitud = ReservaGuarda & {
  fechaEvento?: string | null;
  numAdultosNinosMayores4?: number | null;
  duracionHoras?: number | null;
  horario?: string | null;
};

/**
 * Indica si la RESERVA es un origen válido de ESTADO para "Generar presupuesto".
 * NO comprueba completitud de datos ni datos fiscales; solo la guarda de
 * sub-estado. Se usa para separar el motivo de bloqueo (estado vs. datos).
 */
const origenEstadoValido = (reserva: ReservaGuarda): boolean =>
  reserva.estado === 'consulta' &&
  SUB_ESTADOS_ORIGEN_VALIDO.includes(
    reserva.subEstado as (typeof SUB_ESTADOS_ORIGEN_VALIDO)[number],
  );

/**
 * Enumera los datos de completitud (fecha, invitados, duración, hora de inicio)
 * que le FALTAN a la RESERVA para poder presupuestar (US-051 §Punto 3). Devuelve
 * `[]` cuando están todos presentes. `numAdultosNinosMayores4` requiere ≥ 1
 * (0/null cuenta como faltante). NO comprueba el estado ni los datos fiscales.
 */
export const camposCompletitudFaltantes = (
  reserva: ReservaCompletitud,
): CampoCompletitudPresupuesto[] => {
  const faltantes: CampoCompletitudPresupuesto[] = [];
  if (!reserva.fechaEvento) faltantes.push('fechaEvento');
  if (!reserva.numAdultosNinosMayores4 || reserva.numAdultosNinosMayores4 < 1) {
    faltantes.push('numAdultosNinosMayores4');
  }
  if (!reserva.duracionHoras) faltantes.push('duracionHoras');
  if (!reserva.horario) faltantes.push('horario');
  return faltantes;
};

/**
 * Indica si se puede ofrecer "Generar presupuesto" habilitado: exige el origen de
 * estado/sub-estado válido (`consulta` + `2a/2b/2c/2v`) Y la completitud de datos
 * del evento (US-051 §Punto 3). NO comprueba datos fiscales ni presupuesto
 * existente (eso lo revalida el backend con su desenlace específico).
 */
export const puedeGenerarPresupuesto = (reserva: ReservaCompletitud): boolean =>
  origenEstadoValido(reserva) && camposCompletitudFaltantes(reserva).length === 0;

/**
 * Explica por qué NO se puede generar el presupuesto, para el texto de la ficha
 * cuando el botón queda deshabilitado. Prioriza el motivo de ESTADO
 * (2d/terminales/pre_reserva+); si el estado es válido pero faltan datos, enumera
 * los campos faltantes y sugiere "Editar consulta" (US-051 §Punto 3).
 */
export const motivoNoPuedeGenerar = (reserva: ReservaCompletitud): string => {
  if (reserva.estado !== 'consulta') {
    return 'Esta reserva ya ha superado la fase de consulta; el presupuesto no puede regenerarse desde aquí.';
  }
  if (reserva.subEstado === '2d') {
    return 'Esta consulta está en cola de espera. Debe promoverse a bloqueante antes de generar un presupuesto (UC-12).';
  }
  if (!origenEstadoValido(reserva)) {
    return 'Esta consulta está en un estado terminal y no admite la generación de un presupuesto.';
  }
  const faltantes = camposCompletitudFaltantes(reserva);
  const lista = faltantes.map((campo) => ETIQUETA_CAMPO_COMPLETITUD[campo]).join(', ');
  return `Faltan datos para generar el presupuesto: ${lista}. Usa "Editar consulta" para completarlos.`;
};

/**
 * Guarda de cliente para la acción "Editar presupuesto" (US-015 · UC-15). Espejo de
 * la precondición del servidor: solo se ofrece sobre una RESERVA en
 * `estado='pre_reserva'`. Un PRESUPUESTO `aceptado` (señal confirmada vía UC-17) o
 * `rechazado` mueve la RESERVA fuera de `pre_reserva` (a `reserva_confirmada` u otro
 * estado), de modo que el estado de la RESERVA es un espejo suficiente en cliente;
 * el servidor revalida defensivamente el estado del último PRESUPUESTO (409). Solo
 * habilita/deshabilita la acción en la ficha.
 */
export const puedeEditarPresupuesto = (reserva: { estado?: string }): boolean =>
  reserva.estado === 'pre_reserva';

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
