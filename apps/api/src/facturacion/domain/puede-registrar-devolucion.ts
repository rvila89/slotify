/**
 * Guarda de precondición de la DEVOLUCIÓN de la FIANZA — MÁQUINA DE ESTADOS de DOMINIO PURO
 * (US-036 / UC-27; spec-delta `facturacion` Requirements "Precondición triple de disponibilidad
 * del registro de devolución" y "Guarda contra el doble registro"; design.md §D-4). Paso SIMÉTRICO
 * INVERSO de `puede-registrar-cobro-fianza.ts` (US-030), calcado en estructura.
 *
 * Modela la guarda de la transición del sub-proceso de fianza
 * `cobrada → {devuelta | retenida_parcial}` como ESTRUCTURA DE DATOS declarativa (no `if/else`
 * disperso, CLAUDE.md §Máquina de estados). Aplica la PRECONDICIÓN TRIPLE:
 *   - `estado = 'post_evento'` Y `fianzaStatus = 'cobrada'` Y `ibanDevolucion != null` → PROCEDE.
 *   - `estado != 'post_evento'` → BLOQUEA `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `fianzaStatus != 'cobrada'` (p. ej. `recibo_enviado`, `pendiente`) → BLOQUEA
 *     `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `ibanDevolucion == null` → BLOQUEA `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `fianzaStatus ∈ {'devuelta', 'retenida_parcial'}` (ya registrada) → BLOQUEA
 *     `DEVOLUCION_YA_REGISTRADA` (409, doble registro / estado final irreversible).
 *
 * El use-case REEVALÚA esta guarda DENTRO de la transacción tras el `SELECT ... FOR UPDATE`. Sin
 * dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Códigos de bloqueo de la guarda (contrato `DevolucionFianzaError`, 409). */
export type CodigoBloqueoDevolucion = 'PRECONDICION_NO_CUMPLIDA' | 'DEVOLUCION_YA_REGISTRADA';

/** Resultado de la guarda: permitido (procede) o bloqueado con su código. */
export type ResultadoPuedeRegistrarDevolucion =
  | { permitido: true }
  | { permitido: false; codigo: CodigoBloqueoDevolucion };

/** Parámetros de la guarda: estado de la RESERVA, sub-estado de fianza e IBAN del CLIENTE. */
export interface ParametrosPuedeRegistrarDevolucion {
  estado: string;
  fianzaStatus: string;
  ibanDevolucion: string | null;
}

/**
 * Evalúa si se puede registrar la devolución. El doble registro sobre un estado final
 * (`devuelta`/`retenida_parcial`) prevalece con `DEVOLUCION_YA_REGISTRADA`; cualquier otra
 * precondición incompleta bloquea con `PRECONDICION_NO_CUMPLIDA`.
 */
export const puedeRegistrarDevolucion = ({
  estado,
  fianzaStatus,
  ibanDevolucion,
}: ParametrosPuedeRegistrarDevolucion): ResultadoPuedeRegistrarDevolucion => {
  if (fianzaStatus === 'devuelta' || fianzaStatus === 'retenida_parcial') {
    return { permitido: false, codigo: 'DEVOLUCION_YA_REGISTRADA' };
  }
  if (estado !== 'post_evento' || fianzaStatus !== 'cobrada' || ibanDevolucion == null) {
    return { permitido: false, codigo: 'PRECONDICION_NO_CUMPLIDA' };
  }
  return { permitido: true };
};
