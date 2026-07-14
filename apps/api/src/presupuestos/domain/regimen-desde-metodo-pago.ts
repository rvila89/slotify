/**
 * Derivación del RÉGIMEN FISCAL a partir del MÉTODO DE PAGO — DOMINIO PURO (épico #6,
 * rebanada 6.2 `documentos-presupuesto-sin-iva-doble-numeracion`, design.md D1).
 *
 * El gestor elige el MÉTODO DE PAGO al generar el presupuesto; el RÉGIMEN FISCAL es su
 * consecuencia derivada (persistida y usada por el cálculo, el render y la numeración):
 *   - `transferencia ⇒ con_iva` (el cliente paga con el 21% incluido).
 *   - `efectivo      ⇒ sin_iva` (el cliente en efectivo paga sin el 21%, importe MENOR).
 *
 * La derivación es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa
 * `@nestjs/*`, Prisma ni infraestructura. El mapeo se modela como una ESTRUCTURA DE DATOS
 * declarativa (no `if` disperso), coherente con la máquina de estados del dominio.
 */

/** Régimen fiscal derivado, persistido en `Presupuesto.regimen_iva`. */
export type RegimenIva = 'con_iva' | 'sin_iva';

/** Método de pago elegido por el gestor, persistido en `Presupuesto.metodo_pago`. */
export type MetodoPago = 'transferencia' | 'efectivo';

/**
 * Mapa declarativo TOTAL método de pago → régimen fiscal. Cada `MetodoPago` del dominio
 * tiene exactamente un `RegimenIva`; el tipo `Record` obliga a cubrir todos los métodos.
 */
const REGIMEN_POR_METODO: Record<MetodoPago, RegimenIva> = {
  transferencia: 'con_iva',
  efectivo: 'sin_iva',
};

/** Deriva el régimen fiscal del método de pago elegido (mapa declarativo, determinista). */
export const regimenDesdeMetodoPago = (metodoPago: MetodoPago): RegimenIva =>
  REGIMEN_POR_METODO[metodoPago];

/** ¿El valor es un método de pago válido del dominio? (guarda para el use-case). */
export const esMetodoPagoValido = (valor: unknown): valor is MetodoPago =>
  valor === 'transferencia' || valor === 'efectivo';
