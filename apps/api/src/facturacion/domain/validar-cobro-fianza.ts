/**
 * Validaciones de DOMINIO PURO del cobro de la FIANZA (US-030 / UC-22 pasos 5-9; spec-delta
 * `facturacion` Requirement "Validación de fecha de cobro no posterior al evento e importe
 * positivo"; design.md §D-1/§D-3).
 *
 * Invariantes previas a crear el PAGO de la fianza:
 *   - `importe > 0` (0 o negativo → `CobroInvalidoError`).
 *   - `fecha_cobro <= fecha_evento` (posterior al evento → `CobroInvalidoError`).
 *
 * A DIFERENCIA de la liquidación (US-029, que validaba `fecha_cobro <= hoy`), la fianza valida
 * `fecha_cobro <= RESERVA.fecha_evento` (relativo al evento). La `fechaEvento` se INYECTA desde la
 * RESERVA; el dominio nunca lee la fecha real.
 *
 * El importe llega como Decimal(10,2) string (contrato `Importe`); la comparación se hace en
 * CÉNTIMOS enteros (nunca aritmética float). Función de flecha inmutable, sin dependencias de
 * framework/infra (hook `no-infra-in-domain`). El error mapea a HTTP 400 `COBRO_INVALIDO`.
 */

/** Parámetros de la validación del cobro de la fianza. */
export interface ParametrosValidarCobroFianza {
  /** Importe realmente cobrado (Importe string de 2 decimales). */
  importe: string;
  /** Fecha del cobro introducida por el Gestor. */
  fechaCobro: Date;
  /** Fecha del evento de la RESERVA (cota superior de la fecha de cobro). */
  fechaEvento: Date;
}

/**
 * Error de DOMINIO: cobro inválido (importe no positivo o fecha de cobro posterior al evento). La
 * aplicación/controlador lo mapea a HTTP 400 (`COBRO_INVALIDO`, contrato `CobroFianzaError`).
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
 * Valida las invariantes del cobro de la fianza. Lanza `CobroInvalidoError` si `importe <= 0` o si
 * `fecha_cobro` es posterior a `fecha_evento`. No devuelve nada cuando el cobro es válido.
 */
export const validarCobroFianza = ({
  importe,
  fechaCobro,
  fechaEvento,
}: ParametrosValidarCobroFianza): void => {
  const importeCentimos = aCentimos(importe);
  if (!Number.isFinite(importeCentimos) || importeCentimos <= 0) {
    throw new CobroInvalidoError('El importe del cobro debe ser mayor que 0');
  }
  if (aDiaUtc(fechaCobro) > aDiaUtc(fechaEvento)) {
    throw new CobroInvalidoError('La fecha de cobro no puede ser posterior al evento');
  }
};
