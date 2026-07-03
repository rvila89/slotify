/**
 * Alias de tipos del dominio de confirmación (US-021 · UC-17) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * páginas, hooks y componentes. No se inventan tipos de API: todos derivan del
 * SDK generado (única fuente de verdad).
 */
import type { components } from '@/api-client';

export type Reserva = components['schemas']['Reserva'];
export type Documento = components['schemas']['Documento'];
export type Factura = components['schemas']['Factura'];
export type ConfirmarSenalResponse = components['schemas']['ConfirmarSenalResponse'];
export type ConfirmarSenalValidacionError =
  components['schemas']['ConfirmarSenalValidacionError'];
export type ConfirmarSenalConflictoError =
  components['schemas']['ConfirmarSenalConflictoError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Error normalizado de la confirmación de señal, para que la UI ramifique en
 * español sin volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con un caso del
 * contrato OpenAPI de US-021 (422 `ConfirmarSenalValidacionError` / 409
 * `ConfirmarSenalConflictoError`). Los mensajes literales son los de la spec-delta.
 */
export type ConfirmarSenalError = {
  /**
   * `origen-invalido` (422 ORIGEN_INVALIDO), `justificante-requerido` (422),
   * `formato-no-permitido` (422), `tamano-excedido` (422), `importe-invalido`
   * (422 IMPORTE_TOTAL_INVALIDO), `reserva-ya-confirmada` (409),
   * `fecha-no-disponible` (409) o `generico` (401/403/404/red).
   */
  tipo:
    | 'origen-invalido'
    | 'justificante-requerido'
    | 'formato-no-permitido'
    | 'tamano-excedido'
    | 'importe-invalido'
    | 'reserva-ya-confirmada'
    | 'fecha-no-disponible'
    | 'generico';
  mensaje: string;
};
