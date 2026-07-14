/**
 * Numeración `AAAANNN` del presupuesto CON IVA — DOMINIO PURO (épico #6, rebanada
 * 6.1b `documentos-presupuesto-pdf-con-iva`, design.md N1/N2).
 *
 * Calcula el SIGUIENTE número a partir del año de emisión y el ÚLTIMO número existente
 * del tenant en ese año (que llega ya resuelto por la capa de aplicación/infra; la
 * consulta `MAX` a BD y el reintento ante `P2002` viven fuera del dominio, estilo
 * `facturacion/domain/numeracion-factura.ts`).
 *
 *   AAAA = año de emisión (año calendario en curso), embebido como prefijo literal.
 *   NNN  = MAX(NNN) + 1 entre los presupuestos del tenant en ese año; padding a MÍNIMO 3
 *          dígitos con ceros a la izquierda. A partir de 999 crece el número natural.
 *
 * La unicidad `(tenant_id, numero_presupuesto)` (con el año embebido) cubre "único por
 * tenant + año" y garantiza el reinicio por año (en el año nuevo no hay número previo →
 * 001). Función de flecha inmutable, sin dependencias de framework/infra (hook
 * `no-infra-in-domain`).
 */

/** Padding mínimo de la secuencia NNN. */
const PADDING_MINIMO = 3;

/** Parámetros del cálculo del siguiente número de presupuesto. */
export interface SiguienteNumeroPresupuestoParams {
  /** Año de emisión (año calendario en curso). */
  anio: number;
  /** Último `numero_presupuesto` del tenant en ese año, o `null` si no hay ninguno. */
  ultimoNumero: string | null;
}

/** Prefijo literal `AAAA` del número de presupuesto para un año dado. */
export const prefijoNumeroPresupuesto = (anio: number): string => String(anio);

/**
 * Deriva el siguiente número `AAAANNN`. Si no hay número previo (primer presupuesto del
 * tenant en el año, o año nuevo), devuelve `AAAA001`. Si el previo no pertenece al año
 * dado, se ignora su secuencia y se reinicia a 001 (defensa; la infra ya filtra por año).
 */
export const siguienteNumeroPresupuesto = (
  params: SiguienteNumeroPresupuestoParams,
): string => {
  const prefijo = prefijoNumeroPresupuesto(params.anio);
  const secuenciaPrevia =
    params.ultimoNumero !== null && params.ultimoNumero.startsWith(prefijo)
      ? Number(params.ultimoNumero.slice(prefijo.length))
      : 0;
  const siguiente = secuenciaPrevia + 1;
  return `${prefijo}${String(siguiente).padStart(PADDING_MINIMO, '0')}`;
};
