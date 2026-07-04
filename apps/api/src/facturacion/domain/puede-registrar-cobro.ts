/**
 * Guarda de precondición del cobro de la liquidación — MÁQUINA DE ESTADOS de DOMINIO PURO
 * (US-029 / UC-21; spec-delta `facturacion` Requirements "Guarda contra el doble cobro" y
 * "Precondición de estado — solo se cobra desde facturada"; design.md §D-2).
 *
 * La guarda se modela como ESTRUCTURA DE DATOS declarativa (no `if/else` disperso, CLAUDE.md
 * §Máquina de estados):
 *   - `facturada` → PROCEDE (única precondición válida).
 *   - `pendiente` → BLOQUEA `LIQUIDACION_NO_FACTURADA` (la factura aún no fue enviada).
 *   - `cobrada`   → BLOQUEA `LIQUIDACION_YA_COBRADA` (doble cobro).
 *
 * El use-case REEVALÚA esta guarda DENTRO de la transacción tras el `SELECT ... FOR UPDATE`
 * sobre la RESERVA (la concurrencia real vive en la integración). Sin dependencias de
 * framework/infra (hook `no-infra-in-domain`).
 */

/** Sub-estados de liquidación de la RESERVA relevantes para el cobro. */
export type LiquidacionStatusCobro = 'pendiente' | 'facturada' | 'cobrada';

/** Códigos de bloqueo de la guarda (contrato `CobroLiquidacionError`, 409). */
export type CodigoBloqueoCobro = 'LIQUIDACION_NO_FACTURADA' | 'LIQUIDACION_YA_COBRADA';

/** Resultado de la guarda: permitido (procede) o bloqueado (con código y motivo). */
export type ResultadoPuedeRegistrarCobro =
  | { permitido: true }
  | { permitido: false; codigo: CodigoBloqueoCobro; motivo: string };

/** Mensaje de bloqueo por precondición no cumplida (`pendiente`). */
const MOTIVO_NO_FACTURADA =
  'La factura de liquidación debe estar enviada antes de registrar su cobro';
/** Mensaje de bloqueo por doble cobro (`cobrada`). */
const MOTIVO_YA_COBRADA = 'La liquidación ya está marcada como cobrada';

/**
 * Tabla declarativa de la guarda: mapea cada `liquidacion_status` a su resultado. `facturada`
 * es la única transición hacia el cobro que procede.
 */
const GUARDA_COBRO: Readonly<Record<LiquidacionStatusCobro, ResultadoPuedeRegistrarCobro>> = {
  facturada: { permitido: true },
  pendiente: {
    permitido: false,
    codigo: 'LIQUIDACION_NO_FACTURADA',
    motivo: MOTIVO_NO_FACTURADA,
  },
  cobrada: {
    permitido: false,
    codigo: 'LIQUIDACION_YA_COBRADA',
    motivo: MOTIVO_YA_COBRADA,
  },
};

/**
 * Evalúa si se puede registrar el cobro desde el `liquidacion_status` dado. Devuelve la entrada
 * de la tabla declarativa; un estado desconocido bloquea por precondición (conservador).
 */
export const puedeRegistrarCobro = (
  liquidacionStatus: LiquidacionStatusCobro,
): ResultadoPuedeRegistrarCobro =>
  GUARDA_COBRO[liquidacionStatus] ?? {
    permitido: false,
    codigo: 'LIQUIDACION_NO_FACTURADA',
    motivo: MOTIVO_NO_FACTURADA,
  };
