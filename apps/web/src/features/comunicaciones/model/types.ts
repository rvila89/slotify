/**
 * Alias de tipos del dominio de comunicaciones (US-046 · UC-36) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * componentes y hooks. No se inventan tipos de API: todos derivan del SDK generado
 * (única fuente de verdad); el cliente generado no se edita a mano.
 */
import type { components } from '@/api-client';

export type Comunicacion = components['schemas']['Comunicacion'];
export type ComunicacionListItem = components['schemas']['ComunicacionListItem'];
export type EstadoComunicacion = components['schemas']['EstadoComunicacion'];
export type CodigoEmail = components['schemas']['CodigoEmail'];
export type EnviarBorradorRequest = components['schemas']['EnviarBorradorRequest'];
export type CrearEmailManualRequest = components['schemas']['CrearEmailManualRequest'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Desenlace de error del envío de un borrador (US-046 · UC-36), normalizado a una
 * unión discriminada en español para que la UI ramifique por `tipo`, no por status:
 *  - `destinatario` (422 `DESTINATARIO_INVALIDO`): `CLIENTE.email` nulo/ inválido. NO se
 *    intenta el envío; el borrador **permanece en `borrador`** (recuperable).
 *  - `conflicto` (409 `ESTADO_NO_BORRADOR`): la fila ya no está en `borrador`
 *    (ya `enviado`/`fallido`); solo lectura. Hay que refrescar la lista.
 *  - `proveedor` (502 `PROVEEDOR_EMAIL_FALLIDO`): se intentó el envío y el proveedor
 *    falló; la fila queda persistida en `fallido`. Reintentable (sin reintento auto).
 *  - `generico` (400/401/403/404/red): error no accionable de forma específica.
 */
export type EnviarBorradorError =
  | { tipo: 'destinatario'; mensaje: string }
  | { tipo: 'conflicto'; mensaje: string; estadoActual?: EstadoComunicacion }
  | { tipo: 'proveedor'; mensaje: string }
  | { tipo: 'generico'; mensaje: string };

/**
 * Desenlace de error del descarte de un borrador (US-046 · UC-36):
 *  - `conflicto` (409 `ESTADO_NO_BORRADOR`): la fila ya no está en `borrador`; refrescar.
 *  - `generico`: resto.
 */
export type DescartarBorradorError =
  | { tipo: 'conflicto'; mensaje: string; estadoActual?: EstadoComunicacion }
  | { tipo: 'generico'; mensaje: string };

/**
 * Desenlace de error del email manual (US-046 · UC-36):
 *  - `destinatario` (422): `CLIENTE.email` nulo/ inválido; no se crea ni envía nada.
 *  - `proveedor` (502): el proveedor falló; la fila queda persistida en `fallido`.
 *  - `generico`: 400/401/403/404/red.
 */
export type CrearEmailManualError =
  | { tipo: 'destinatario'; mensaje: string }
  | { tipo: 'proveedor'; mensaje: string }
  | { tipo: 'generico'; mensaje: string };
