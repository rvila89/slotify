/**
 * Tipos de DOMINIO del motor de email (US-045 / UC-35).
 *
 * Tipos puros (sin `@nestjs/*`, Prisma ni infraestructura): describen el código de
 * plantilla del ciclo de vida (E1–E8) más el `manual` (borradores desvinculados de
 * trigger, US-046) y el estado de la trazabilidad en `COMUNICACION`. Alineados con
 * los enums `CodigoEmail` y `EstadoComunicacion` de Prisma (schema US-000), pero
 * declarados aquí como uniones de literales para que el dominio no dependa del ORM.
 */

/**
 * Código de plantilla del catálogo: hitos E1–E8 del ciclo, `E9` (modificación de reserva
 * en la ventana viva, change `reserva-viva-edicion-recalculo-ficha`) o envío `manual`.
 */
export type CodigoEmail =
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E5'
  | 'E6'
  | 'E7'
  | 'E8'
  | 'E9'
  | 'manual';

/** Estado de la trazabilidad de una comunicación. */
export type EstadoComunicacion = 'borrador' | 'enviado' | 'fallido';
