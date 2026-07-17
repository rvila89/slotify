/**
 * Alias de tipos del dominio de captura de la documentación obligatoria del evento
 * (US-033 · UC-24) sobre el cliente generado del contrato OpenAPI (`@/api-client`).
 * No se inventan tipos de API: todos derivan del SDK generado (única fuente de
 * verdad). Los nombres del wire son los congelados en el contrato.
 */
import type { components } from '@/api-client';

export type TipoDocumentoEvento = components['schemas']['TipoDocumentoEvento'];
export type DocumentoEvento = components['schemas']['DocumentoEvento'];
export type ChecklistItemDocumentacionEvento =
  components['schemas']['ChecklistItemDocumentacionEvento'];
export type ChecklistDocumentacionEvento = components['schemas']['ChecklistDocumentacionEvento'];
export type SubirDocumentoEventoResponse = components['schemas']['SubirDocumentoEventoResponse'];
export type SubirDocumentoEventoValidacionError =
  components['schemas']['SubirDocumentoEventoValidacionError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Error normalizado de la subida de un documento del evento, para que la UI
 * ramifique en español sin volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con
 * un caso del contrato de US-033:
 *  - `estado-no-permite` → 422 `ESTADO_NO_PERMITE_DOCUMENTACION` (reserva fuera de
 *    `evento_en_curso`).
 *  - `tipo-no-permitido` → 422 `TIPO_DOCUMENTO_NO_PERMITIDO`.
 *  - `archivo-requerido` → 422 `ARCHIVO_REQUERIDO` (no se adjuntó fichero).
 *  - `formato-no-permitido` → 422 `FORMATO_NO_PERMITIDO`.
 *  - `archivo-invalido` → 422 `ARCHIVO_INVALIDO` (vacío o corrupto).
 *  - `tamano-excedido` → 422 `TAMANO_EXCEDIDO`.
 *  - `no-encontrada` → 404 (reserva inexistente / de otro tenant).
 *  - `generico` → 400/401/403/red.
 */
export type SubirDocumentoEventoError = {
  tipo:
    | 'estado-no-permite'
    | 'tipo-no-permitido'
    | 'archivo-requerido'
    | 'formato-no-permitido'
    | 'archivo-invalido'
    | 'tamano-excedido'
    | 'no-encontrada'
    | 'generico';
  mensaje: string;
};
