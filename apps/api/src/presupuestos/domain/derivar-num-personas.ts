/**
 * Derivación del nº de personas del documento de presupuesto (change
 * `pdf-presupuesto-horario-idioma`, Mejora 1) — helper PURO de dominio de `presupuestos`.
 *
 * design.md D5 + memoria del proyecto "aforo/personas es campo derivado": el nº de
 * personas es `numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)`, con
 * los nulls tratados como 0 (consistente con el adaptador de carga). Corrige la deuda
 * conocida por la que el adaptador solo tomaba `numAdultosNinosMayores4`. Sin imports de
 * framework/infra (hook `no-infra-in-domain`); arrow function (ESLint `func-style`).
 */

/** Aforo bruto de la reserva del que se deriva el nº de personas del documento. */
export interface AforoReserva {
  numInvitadosFinal: number | null;
  numAdultosNinosMayores4: number | null;
  numNinosMenores4: number | null;
}

/**
 * Deriva el nº de personas del documento: `numInvitadosFinal` cuando está informado; si
 * no, la suma del desglose de aforo (nulls como 0).
 */
export const derivarNumPersonas = (aforo: AforoReserva): number =>
  aforo.numInvitadosFinal ??
  (aforo.numAdultosNinosMayores4 ?? 0) + (aforo.numNinosMenores4 ?? 0);
