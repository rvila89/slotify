/**
 * Validaciones de DOMINIO PURO del cobro de la liquidación (US-029 / UC-21 pasos 7-10;
 * spec-delta `facturacion` Requirement "Validación de fecha de cobro no futura e importe
 * positivo"; design.md §D-2).
 *
 * Invariantes previas a crear el PAGO:
 *   - `importe > 0` (0 o negativo → `CobroInvalidoError`).
 *   - `fecha_cobro <= hoy` (fecha futura → `CobroInvalidoError`).
 * `hoy` se INYECTA (reloj) para determinismo: el dominio nunca lee la fecha real.
 *
 * El importe llega como Decimal(10,2) string (contrato `Importe`); la comparación se hace en
 * CÉNTIMOS enteros (nunca aritmética float). Función de flecha inmutable, sin dependencias de
 * framework/infra (hook `no-infra-in-domain`).
 */

/** Parámetros de la validación del cobro. */
export interface ParametrosValidarCobro {
  /** Importe realmente cobrado (Importe string de 2 decimales). */
  importe: string;
  /** Fecha del cobro introducida por el Gestor. */
  fechaCobro: Date;
  /** Fecha actual inyectada (reloj) para determinismo. */
  hoy: Date;
}

/**
 * Error de DOMINIO: cobro inválido (importe no positivo o fecha de cobro futura). La
 * aplicación/controlador lo mapea a HTTP 400 (`COBRO_INVALIDO`, contrato `CobroLiquidacionError`).
 */
export class CobroInvalidoError extends Error {
  readonly codigo = 'COBRO_INVALIDO' as const;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'CobroInvalidoError';
  }
}

/** Convierte un Importe string de euros a céntimos enteros (sin ruido de coma flotante). */
const aCentimos = (importe: string): number => Math.round(Number(importe) * 100);

/** Normaliza una fecha a su día UTC (00:00) para comparar sin arrastrar horas. */
const aDiaUtc = (fecha: Date): number =>
  Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());

/**
 * Valida las invariantes del cobro. Lanza `CobroInvalidoError` si `importe <= 0` o si
 * `fecha_cobro` es posterior a `hoy`. No devuelve nada cuando el cobro es válido.
 */
export const validarCobro = ({ importe, fechaCobro, hoy }: ParametrosValidarCobro): void => {
  const importeCentimos = aCentimos(importe);
  if (!Number.isFinite(importeCentimos) || importeCentimos <= 0) {
    throw new CobroInvalidoError('El importe del cobro debe ser mayor que 0');
  }
  if (aDiaUtc(fechaCobro) > aDiaUtc(hoy)) {
    throw new CobroInvalidoError('La fecha de cobro no puede ser futura');
  }
};
