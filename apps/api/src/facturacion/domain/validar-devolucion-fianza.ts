/**
 * Validaciones de DOMINIO PURO de la DEVOLUCIÓN de la FIANZA (US-036 / UC-27 pasos 4-8; spec-delta
 * `facturacion` Requirements "Validación del importe devuelto no superior a la fianza cobrada",
 * "Validación de la fecha de devolución no anterior a la fecha de cobro de la fianza",
 * "Devolución parcial o retención total … con motivo"; design.md §D-3). Paso SIMÉTRICO INVERSO de
 * `validar-cobro-fianza.ts` (US-030), calcado en estructura y estilo.
 *
 * Invariantes previas a mutar la RESERVA:
 *   - `importeDevuelto <= fianzaEur` (superior → `ImporteSuperaFianzaError`).
 *   - `importeDevuelto >= 0` (negativo → `ImporteSuperaFianzaError`; `0.00` es VÁLIDO — retención
 *     total).
 *   - `fechaCobro >= fianzaCobradaFecha` (anterior → `FechaDevolucionInvalidaError`).
 *   - Motivo obligatorio SOLO si el resultado sería `retenida_parcial` (importe < fianzaEur):
 *     ausente/vacío → `MotivoRetencionRequeridoError`.
 *
 * A DIFERENCIA del cobro (US-030, `fecha_cobro <= fecha_evento`), la devolución valida
 * `fecha_cobro >= fianza_cobrada_fecha` (relativo al cobro previo de la fianza). La `fianzaEur` y
 * la `fianzaCobradaFecha` se INYECTAN desde la RESERVA; el dominio nunca lee la fecha real ni
 * consulta infra (hook `no-infra-in-domain`).
 *
 * Los importes llegan como Decimal(10,2) string (contrato `Importe`); la comparación es en
 * CÉNTIMOS enteros (NUNCA float), para que `== fianzaEur` no dé falsos negativos. Los códigos
 * mapean a HTTP 400 en el controlador (contrato `DevolucionFianzaError`).
 */

/** Parámetros de la validación de la devolución de la fianza. */
export interface ParametrosValidarDevolucionFianza {
  /** Importe realmente devuelto (Importe string de 2 decimales, `0.00 ≤ x ≤ fianzaEur`). */
  importeDevuelto: string;
  /** Importe de la fianza cobrada (cota superior del importe devuelto). */
  fianzaEur: string;
  /** Fecha del abono de la devolución introducida por el Gestor. */
  fechaCobro: Date;
  /** Fecha del cobro previo de la fianza (cota inferior de la fecha de devolución). */
  fianzaCobradaFecha: Date;
  /** Motivo de la retención (obligatorio solo si el resultado es `retenida_parcial`). */
  motivoRetencion?: string | null;
}

/**
 * Error de DOMINIO: el importe devuelto supera la fianza cobrada o es negativo. Se mapea a HTTP
 * 400 (`IMPORTE_SUPERA_FIANZA`, contrato `DevolucionFianzaError`, FA-02).
 */
export class ImporteSuperaFianzaError extends Error {
  readonly codigo = 'IMPORTE_SUPERA_FIANZA' as const;

  constructor(motivo = 'El importe a devolver no puede superar la fianza cobrada') {
    super(motivo);
    this.name = 'ImporteSuperaFianzaError';
  }
}

/**
 * Error de DOMINIO: la fecha de devolución es anterior a la fecha de cobro de la fianza. Se mapea
 * a HTTP 400 (`FECHA_DEVOLUCION_INVALIDA`, contrato `DevolucionFianzaError`, FA-03).
 */
export class FechaDevolucionInvalidaError extends Error {
  readonly codigo = 'FECHA_DEVOLUCION_INVALIDA' as const;

  constructor(
    motivo = 'La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza',
  ) {
    super(motivo);
    this.name = 'FechaDevolucionInvalidaError';
  }
}

/**
 * Error de DOMINIO: falta el motivo de retención en una devolución parcial. Se mapea a HTTP 400
 * (`MOTIVO_RETENCION_REQUERIDO`, contrato `DevolucionFianzaError`).
 */
export class MotivoRetencionRequeridoError extends Error {
  readonly codigo = 'MOTIVO_RETENCION_REQUERIDO' as const;

  constructor(motivo = 'El motivo de retención es obligatorio en una devolución parcial') {
    super(motivo);
    this.name = 'MotivoRetencionRequeridoError';
  }
}

/** Convierte un Importe string de euros a céntimos enteros (sin ruido de coma flotante). */
const aCentimos = (importe: string): number => Math.round(Number(importe) * 100);

/**
 * Valida las invariantes de la devolución de la fianza. Lanza `ImporteSuperaFianzaError` si el
 * importe devuelto es negativo o supera la fianza; `FechaDevolucionInvalidaError` si la fecha es
 * anterior al cobro de la fianza; `MotivoRetencionRequeridoError` si el resultado es parcial y
 * falta el motivo. No devuelve nada cuando la devolución es válida.
 */
export const validarDevolucionFianza = ({
  importeDevuelto,
  fianzaEur,
  fechaCobro,
  fianzaCobradaFecha,
  motivoRetencion,
}: ParametrosValidarDevolucionFianza): void => {
  const importeCentimos = aCentimos(importeDevuelto);
  const fianzaCentimos = aCentimos(fianzaEur);

  if (!Number.isFinite(importeCentimos) || importeCentimos < 0) {
    throw new ImporteSuperaFianzaError();
  }
  if (importeCentimos > fianzaCentimos) {
    throw new ImporteSuperaFianzaError();
  }
  if (fechaCobro.getTime() < fianzaCobradaFecha.getTime()) {
    throw new FechaDevolucionInvalidaError();
  }
  // El motivo solo es obligatorio cuando el resultado es `retenida_parcial` (importe < fianzaEur).
  const esParcial = importeCentimos < fianzaCentimos;
  if (esParcial && (motivoRetencion == null || motivoRetencion.trim() === '')) {
    throw new MotivoRetencionRequeridoError();
  }
};
