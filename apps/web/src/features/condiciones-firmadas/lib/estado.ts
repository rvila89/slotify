/**
 * Guardas de cliente para el registro de firma de condiciones particulares
 * (US-024 · UC-19, segundo flujo). Espejo de las guardas declarativas del backend;
 * solo deciden qué mostrar/habilitar en la UI. El servidor revalida siempre de
 * forma autoritativa (409 CONDICIONES_NO_ENVIADAS / 422 ESTADO_INVALIDO).
 */

/** Estados en los que la firma puede registrarse (D-no-transicion del design). */
const ESTADOS_VALIDOS = ['reserva_confirmada', 'evento_en_curso', 'post_evento'] as const;

type ReservaGuarda = {
  estado?: string;
  /** `RESERVA.condPartFechaEnvio` — E3 enviado (US-023) si no es nulo. */
  condPartFechaEnvio?: string | null;
  /** `RESERVA.condPartFirmadas` — copia firmada ya registrada. */
  condPartFirmadas?: boolean | null;
};

/**
 * La sección de firma es relevante en la ficha cuando la RESERVA está en uno de los
 * tres estados válidos del ciclo (`reserva_confirmada`, `evento_en_curso`,
 * `post_evento`). Fuera de ellos (consulta, pre_reserva, terminales) no se muestra.
 */
export const debeMostrarSeccionCondiciones = (reserva: ReservaGuarda): boolean =>
  ESTADOS_VALIDOS.some((estado) => estado === reserva.estado);

/**
 * Precondición de negocio del envío de E3 (US-023): las condiciones deben haberse
 * enviado al cliente (`condPartFechaEnvio` no nulo) antes de poder registrar la
 * firma. Si es nulo, la acción NO está disponible y se muestra el mensaje guía.
 */
export const condicionesEnviadas = (reserva: ReservaGuarda): boolean =>
  Boolean(reserva.condPartFechaEnvio);

/** Indica si ya hay una copia firmada registrada (`condPartFirmadas=true`). */
export const condicionesFirmadas = (reserva: ReservaGuarda): boolean =>
  reserva.condPartFirmadas === true;

/** Mensaje literal cuando E3 aún no se ha enviado (acción no disponible). */
export const MENSAJE_CONDICIONES_NO_ENVIADAS =
  'Las condiciones particulares no han sido enviadas al cliente aún';

/** Mensaje literal de la alerta informativa de firma pendiente (FA-01, no bloqueante). */
export const MENSAJE_FIRMA_PENDIENTE = 'Condiciones particulares pendientes de firma';
