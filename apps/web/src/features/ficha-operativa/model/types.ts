/**
 * Alias de tipos del dominio de ficha operativa (US-025 · UC-20) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * componentes y hooks. No se inventan tipos de API: todos derivan del SDK generado
 * (única fuente de verdad).
 */
import type { components } from '@/api-client';

export type FichaOperativa = components['schemas']['FichaOperativa'];
export type GuardarFichaOperativaRequest =
  components['schemas']['GuardarFichaOperativaRequest'];
export type CerrarFichaOperativaResponse =
  components['schemas']['CerrarFichaOperativaResponse'];
export type PreEventoStatus = components['schemas']['PreEventoStatus'];

/**
 * Resultado de leer la ficha (`GET /reservas/{id}/ficha-operativa`) como estado de
 * UI de tres ramas, en lugar de propagar el 409 como error genérico:
 *  - `disponible`: la RESERVA está confirmada (o posterior) → hay `FichaOperativa`.
 *  - `no-disponible` (409 `ficha_no_disponible`, D-3): la RESERVA aún no está
 *    confirmada; la ficha no existe todavía. La UI muestra el mensaje contextual
 *    en lugar del formulario (no es un error bloqueante).
 */
export type EstadoFicha =
  | { tipo: 'disponible'; ficha: FichaOperativa }
  | { tipo: 'no-disponible' };
