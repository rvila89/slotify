/**
 * Numeración secuencial `F-YYYY-NNNN` de la factura — DOMINIO PURO (US-022 / UC-18,
 * design.md §D-3).
 *
 * Calcula el SIGUIENTE número a partir del año de emisión y el ÚLTIMO número existente del
 * tenant en ese año (que llega ya resuelto por la capa de aplicación/infra; la consulta
 * `MAX` a BD y el reintento ante `P2002` viven fuera del dominio).
 *
 *   YYYY = año de emisión (año calendario en curso), embebido en el literal.
 *   NNNN = MAX(NNNN) + 1 entre las facturas del tenant en ese año; padding a MÍNIMO 4
 *          dígitos con ceros a la izquierda. A partir de 9999 crece el número natural.
 *
 * La unicidad `(tenant_id, numero_factura)` (con el año embebido) cubre "único por tenant
 * + año" y garantiza el reinicio por año (en el año nuevo no hay número previo → 0001).
 *
 * Función de flecha inmutable, sin dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Padding mínimo de la secuencia NNNN. */
const PADDING_MINIMO = 4;

/** Parámetros del cálculo del siguiente número. */
export interface SiguienteNumeroParams {
  /** Año de emisión (año calendario en curso). */
  anio: number;
  /** Último `numero_factura` del tenant en ese año, o `null` si no hay ninguna. */
  ultimoNumero: string | null;
}

/** Prefijo literal `F-{año}-` del número de factura para un año dado. */
export const prefijoNumeroFactura = (anio: number): string => `F-${anio}-`;

/**
 * Deriva el siguiente número `F-YYYY-NNNN`. Si no hay número previo (primera del tenant en
 * el año, o año nuevo), devuelve `F-{anio}-0001`. Si el previo no pertenece al año dado, se
 * ignora su secuencia y se reinicia a 0001 (defensa; la infra ya filtra por año).
 */
export const siguienteNumeroFactura = (params: SiguienteNumeroParams): string => {
  const prefijo = prefijoNumeroFactura(params.anio);
  const secuenciaPrevia =
    params.ultimoNumero !== null && params.ultimoNumero.startsWith(prefijo)
      ? Number(params.ultimoNumero.slice(prefijo.length))
      : 0;
  const siguiente = secuenciaPrevia + 1;
  return `${prefijo}${String(siguiente).padStart(PADDING_MINIMO, '0')}`;
};
