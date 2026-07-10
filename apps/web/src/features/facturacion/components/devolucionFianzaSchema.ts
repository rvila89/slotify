import { z } from 'zod';
import { aCentimos } from '../lib/devolucionFianza';

/** Solo dígitos y separadores (miles/decimal): "1.000,50", "1000.50", "1000". */
const CARACTERES_IMPORTE_RE = /^[\d.,]+$/;
/** Forma normalizada esperada por el contrato: Decimal(10,2), p. ej. "1000.00". */
const DECIMAL_2_RE = /^\d+\.\d{2}$/;

/**
 * Valida el importe tecleado contra su forma **normalizada** (no el string crudo), de modo que se
 * acepten los mismos formatos que sugiere el placeholder del campo ("1.000,00" con separador de
 * miles). `aImporte` descarta los separadores de miles y fija 2 decimales; aquí solo comprobamos
 * que la entrada contiene únicamente dígitos/separadores y que su normalización es un Decimal(10,2).
 */
const esImporteValido = (v: string): boolean =>
  CARACTERES_IMPORTE_RE.test(v.trim()) && DECIMAL_2_RE.test(aImporte(v));

/**
 * Normaliza el importe tecleado al `Importe` del contrato = string **Decimal(10,2)**, SIEMPRE con
 * exactamente 2 decimales (p. ej. "1000" → "1000.00", "1.000,5" → "1000.50", "1000.00" → "1000.00").
 *
 * Reglas de separador (tolerantes con la convención del proyecto, espejo del cobro de US-030):
 *  - El **último** `,` o `.` que aparece se interpreta como separador decimal; el resto son de miles
 *    y se descartan. Así "1.000,50" → 1000.50 y también "1000.00" (punto decimal) → 1000.00.
 *  - Sin separador (entero) se le añaden los 2 decimales.
 *
 * El resultado se fija a 2 decimales con `toFixed(2)` porque el DTO del backend exige el patrón
 * `/^\d+\.\d{2}$/` y rechaza (400) un entero sin decimales. Si el valor no es numérico devuelve la
 * cadena saneada tal cual (nunca "NaN") para no romper las validaciones que la consumen.
 */
export const aImporte = (valor: string): string => {
  const limpio = valor.trim();
  const ultimoSeparador = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'));
  const saneado =
    ultimoSeparador === -1
      ? limpio
      : `${limpio.slice(0, ultimoSeparador).replace(/[.,]/g, '')}.${limpio.slice(ultimoSeparador + 1)}`;
  const numero = Number(saneado);
  return Number.isFinite(numero) && saneado !== '' ? numero.toFixed(2) : saneado;
};

/**
 * Esquema de cliente del formulario de devolución de fianza (US-036), parametrizado por la fianza
 * cobrada (`fianzaEur`, tope FA-02) y la fecha de cobro (`fianzaCobradaFecha`, mínimo FA-03). El
 * servidor revalida (400 `IMPORTE_SUPERA_FIANZA` / `FECHA_DEVOLUCION_INVALIDA` / `MOTIVO_RETENCION_REQUERIDO`).
 *
 * - `importeDevuelto`: número válido con máx. 2 decimales, `0 ≤ x ≤ fianzaEur` (0 es válido → retención total).
 * - `fechaCobro`: obligatoria, `≥ fianzaCobradaFecha` (comparación lexicográfica de `YYYY-MM-DD`).
 * - `motivoRetencion`: obligatorio cuando la devolución es parcial (`importeDevuelto < fianzaEur`).
 */
export const construirEsquemaDevolucion = (
  fianzaEur?: string | null,
  fianzaCobradaFecha?: string | null,
) => {
  const topeCentimos = aCentimos(fianzaEur);

  return z
    .object({
      importeDevuelto: z
        .string()
        .trim()
        .min(1, 'Introduce el importe devuelto.')
        .refine(esImporteValido, 'Introduce un importe válido (máx. 2 decimales).')
        .refine((v) => Number(aImporte(v)) >= 0, 'El importe no puede ser negativo.')
        .refine(
          (v) => topeCentimos === null || aCentimos(aImporte(v))! <= topeCentimos,
          'El importe a devolver no puede superar la fianza cobrada.',
        ),
      fechaCobro: z
        .string()
        .min(1, 'Indica la fecha de la devolución.')
        .refine(
          (v) => !fianzaCobradaFecha || v >= fianzaCobradaFecha,
          'La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza.',
        ),
      motivoRetencion: z.string().trim().optional(),
    })
    .superRefine((valores, ctx) => {
      const importe = aCentimos(aImporte(valores.importeDevuelto));
      const esParcial = topeCentimos !== null && importe !== null && importe < topeCentimos;
      if (esParcial && !valores.motivoRetencion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motivoRetencion'],
          message: 'Indica el motivo de la retención (devolución parcial).',
        });
      }
    });
};

export type FormularioDevolucion = z.infer<ReturnType<typeof construirEsquemaDevolucion>>;
