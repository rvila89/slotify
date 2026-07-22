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

/** Lectura cross-tenant de las candidatas al cierre automático A10 (US-026). */
export const CANDIDATAS_CIERRE_FICHA_PORT = Symbol('CANDIDATAS_CIERRE_FICHA_PORT');

/** UoW atómica del cierre automático A10 por RESERVA (US-026). */
export const CIERRE_FICHA_VENCIDA_PORT = Symbol('CIERRE_FICHA_VENCIDA_PORT');

// change `reserva-viva-edicion-recalculo-ficha` — recálculo en cascada de la ventana viva.

/** Motor de tarifa adaptado al recálculo (§D-4.1). */
export const MOTOR_TARIFA_RECALCULO_PORT = Symbol('MOTOR_TARIFA_RECALCULO_PORT');

/** Carga de la RESERVA + factura liquidación para el recálculo (§D-4). */
export const CARGAR_RESERVA_RECALCULO_PORT = Symbol('CARGAR_RESERVA_RECALCULO_PORT');

/** Unidad de trabajo transaccional del recálculo (§D-4.2). */
export const UNIDAD_DE_TRABAJO_RECALCULO_PORT = Symbol(
  'UNIDAD_DE_TRABAJO_RECALCULO_PORT',
);

/** Disparo POST-COMMIT del email E9 de modificación (§D-6). */
export const DISPARAR_E9_PORT = Symbol('DISPARAR_E9_PORT');
