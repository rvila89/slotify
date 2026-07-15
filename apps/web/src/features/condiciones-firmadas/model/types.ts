/**
 * Alias de tipos del dominio de registro de firma de condiciones particulares
 * (US-024 · UC-19, segundo flujo) sobre el cliente generado del contrato OpenAPI
 * (`@/api-client`). No se inventan tipos de API: todos derivan del SDK generado
 * (única fuente de verdad). Los nombres del wire son los congelados en el contrato
 * (`condPartFirmadas`, `condPartFechaEnvio`, `condPartFechaFirma`).
 */
import type { components } from '@/api-client';

export type Reserva = components['schemas']['Reserva'];
export type Documento = components['schemas']['Documento'];
export type RegistrarCondicionesFirmadasResponse =
  components['schemas']['RegistrarCondicionesFirmadasResponse'];
export type CondicionesFirmadasValidacionError =
  components['schemas']['CondicionesFirmadasValidacionError'];
export type CondicionesFirmadasConflictoError =
  components['schemas']['CondicionesFirmadasConflictoError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Error normalizado del registro de firma, para que la UI ramifique en español sin
 * volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con un caso del contrato de
 * US-024:
 *  - `condiciones-no-enviadas` → 409 `CONDICIONES_NO_ENVIADAS` (E3 aún no enviado).
 *  - `estado-invalido` → 422 `ESTADO_INVALIDO` (reserva en estado terminal / fuera
 *    de {reserva_confirmada, evento_en_curso, post_evento}).
 *  - `condiciones-requeridas` / `formato-no-permitido` / `tamano-excedido` → 422
 *    (validación de fichero).
 *  - `generico` → 400/401/403/404/red.
 */
export type CondicionesFirmadasError = {
  tipo:
    | 'condiciones-no-enviadas'
    | 'estado-invalido'
    | 'condiciones-requeridas'
    | 'formato-no-permitido'
    | 'tamano-excedido'
    | 'generico';
  mensaje: string;
};
