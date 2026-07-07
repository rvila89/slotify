/**
 * Guarda de precondición del cobro de la FIANZA — MÁQUINA DE ESTADOS de DOMINIO PURO (US-030 /
 * UC-22; spec-delta `facturacion` Requirements "Guarda contra el doble cobro de la fianza" y
 * "Política Negociable — el cobro con fianza pendiente avisa pero no bloquea"; design.md
 * §D-1/§D-2).
 *
 * La guarda se modela como ESTRUCTURA DE DATOS declarativa (no `if/else` disperso, CLAUDE.md
 * §Máquina de estados). A DIFERENCIA de la liquidación (US-029, donde `pendiente` bloqueaba de
 * forma dura), la fianza aplica la política "Negociable":
 *   - `recibo_enviado` → PROCEDE (happy path; el flag `confirmarSinRecibo` es irrelevante).
 *   - `cobrada`        → BLOQUEA `FIANZA_YA_COBRADA` (doble cobro; ni la confirmación lo levanta).
 *   - `pendiente`      → política "Negociable": SIN `confirmarSinRecibo=true` PIDE CONFIRMACIÓN
 *                        (`RECIBO_FIANZA_NO_ENVIADO`, aviso NO bloqueante, reintentable); CON
 *                        `confirmarSinRecibo=true` PROCEDE (flujo excepcional trazado).
 *
 * El use-case REEVALÚA esta guarda DENTRO de la transacción tras el `SELECT ... FOR UPDATE` sobre
 * la RESERVA (la concurrencia real vive en la integración). Sin dependencias de framework/infra
 * (hook `no-infra-in-domain`).
 */

/** Sub-estados de fianza de la RESERVA relevantes para el cobro. */
export type FianzaStatusCobro = 'pendiente' | 'recibo_enviado' | 'cobrada';

/** Códigos de bloqueo/aviso de la guarda (contrato `CobroFianzaError` 409 / confirmación 200). */
export type CodigoBloqueoCobroFianza = 'FIANZA_YA_COBRADA' | 'RECIBO_FIANZA_NO_ENVIADO';

/**
 * Resultado de la guarda: permitido (procede) o bloqueado. El bloqueo por `pendiente` marca
 * `requiereConfirmacion: true` (aviso reintentable de la política "Negociable"); el bloqueo por
 * doble cobro (`cobrada`) NO lo marca (bloqueo duro).
 */
export type ResultadoPuedeRegistrarCobroFianza =
  | { permitido: true }
  | {
      permitido: false;
      codigo: CodigoBloqueoCobroFianza;
      motivo: string;
      requiereConfirmacion?: boolean;
    };

/** Parámetros de la guarda: el sub-estado de la fianza + la confirmación explícita del Gestor. */
export interface ParametrosPuedeRegistrarCobroFianza {
  fianzaStatus: FianzaStatusCobro;
  confirmarSinRecibo: boolean;
}

/** Mensaje de bloqueo duro por doble cobro (`cobrada`). */
const MOTIVO_YA_COBRADA = 'La fianza ya está marcada como cobrada';
/** Mensaje del aviso "Negociable" por recibo no enviado (`pendiente` sin confirmar). */
const MOTIVO_RECIBO_NO_ENVIADO =
  'El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?';

/**
 * Evalúa si se puede registrar el cobro desde el `fianza_status` dado, aplicando la política
 * "Negociable" para `pendiente`. Un estado desconocido bloquea de forma conservadora como doble
 * cobro (no procede).
 */
export const puedeRegistrarCobroFianza = ({
  fianzaStatus,
  confirmarSinRecibo,
}: ParametrosPuedeRegistrarCobroFianza): ResultadoPuedeRegistrarCobroFianza => {
  if (fianzaStatus === 'recibo_enviado') {
    return { permitido: true };
  }
  if (fianzaStatus === 'cobrada') {
    return { permitido: false, codigo: 'FIANZA_YA_COBRADA', motivo: MOTIVO_YA_COBRADA };
  }
  if (fianzaStatus === 'pendiente') {
    if (confirmarSinRecibo) {
      return { permitido: true };
    }
    return {
      permitido: false,
      codigo: 'RECIBO_FIANZA_NO_ENVIADO',
      motivo: MOTIVO_RECIBO_NO_ENVIADO,
      requiereConfirmacion: true,
    };
  }
  return { permitido: false, codigo: 'FIANZA_YA_COBRADA', motivo: MOTIVO_YA_COBRADA };
};
