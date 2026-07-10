/**
 * Derivación del ESTADO FINAL de la fianza tras la devolución — MÁQUINA DE ESTADOS de DOMINIO PURO
 * (US-036 / UC-27; spec-delta `facturacion` Requirement "Registro de la devolución … con
 * derivación del estado final"; design.md §D-3). Modela la regla como estructura/derivación de
 * datos, NO como código disperso (CLAUDE.md §Máquina de estados).
 *
 * El estado final NO lo elige el Gestor: lo deriva el dominio a partir del importe devuelto y la
 * fianza cobrada:
 *   - `importeDevuelto == fianzaEur` ⇒ `'devuelta'` (devolución completa).
 *   - `importeDevuelto < fianzaEur` (incluido `0.00`) ⇒ `'retenida_parcial'` (parcial o retención
 *     total).
 *
 * La comparación se hace con precisión DECIMAL de 2 posiciones (CÉNTIMOS enteros), NUNCA float,
 * para que `== fianzaEur` no dé falsos negativos de igualdad. La validación de que
 * `importeDevuelto <= fianzaEur` vive en `validarDevolucionFianza` (aquí se asume ya validado). Sin
 * dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Estados finales del sub-proceso de fianza tras la devolución. */
export type EstadoFianzaDevuelta = 'devuelta' | 'retenida_parcial';

/** Parámetros de la derivación del estado final de la fianza. */
export interface ParametrosDerivarEstadoFianzaDevolucion {
  /** Importe efectivamente devuelto (Importe string de 2 decimales). */
  importeDevuelto: string;
  /** Importe de la fianza cobrada (Importe string de 2 decimales). */
  fianzaEur: string;
}

/** Convierte un Importe string de euros a céntimos enteros (sin ruido de coma flotante). */
const aCentimos = (importe: string): number => Math.round(Number(importe) * 100);

/**
 * Deriva el estado final de la fianza: `'devuelta'` si el importe iguala la fianza, o
 * `'retenida_parcial'` si es menor (incluido `0.00`, retención total).
 */
export const derivarEstadoFianzaDevolucion = ({
  importeDevuelto,
  fianzaEur,
}: ParametrosDerivarEstadoFianzaDevolucion): EstadoFianzaDevuelta =>
  aCentimos(importeDevuelto) === aCentimos(fianzaEur) ? 'devuelta' : 'retenida_parcial';
