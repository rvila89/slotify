/**
 * Tokens de inyección (Symbol) de la capability `ficha-evento` (US-025 / UC-20).
 *
 * Cada puerto de dominio se resuelve a su adaptador de infraestructura vía uno de
 * estos Symbols en `ficha-evento.module.ts` (inversión de dependencias hexagonal).
 */

/** Puerto de carga de la RESERVA + ficha filtrada por tenant (RLS). */
export const CARGAR_RESERVA_CON_FICHA_PORT = Symbol('CARGAR_RESERVA_CON_FICHA_PORT');

/** Unidad de trabajo transaccional del guardado parcial de la ficha. */
export const UNIDAD_DE_TRABAJO_GUARDADO_FICHA_PORT = Symbol(
  'UNIDAD_DE_TRABAJO_GUARDADO_FICHA_PORT',
);

/** Unidad de trabajo transaccional del cierre de la ficha. */
export const UNIDAD_DE_TRABAJO_CIERRE_FICHA_PORT = Symbol(
  'UNIDAD_DE_TRABAJO_CIERRE_FICHA_PORT',
);

/** Reloj del sistema (aísla `new Date()`). */
export const CLOCK_FICHA_PORT = Symbol('CLOCK_FICHA_PORT');
