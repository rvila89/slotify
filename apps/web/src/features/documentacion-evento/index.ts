/**
 * API pública del dominio de captura de la documentación obligatoria del evento
 * (US-033 · UC-24): checklist en tiempo real + subida por tipo desde la ficha de
 * la reserva. El resto de la app importa SIEMPRE desde aquí
 * (`@/features/documentacion-evento`), nunca de archivos internos del dominio.
 */
export { DocumentacionEventoCard } from './components/DocumentacionEventoCard';
export { AvisoErrorDocumentacion } from './components/AvisoErrorDocumentacion';
export {
  useChecklistDocumentacionEvento,
  checklistDocumentacionEventoQueryKey,
} from './api/useChecklistDocumentacionEvento';
export { useSubirDocumentoEvento } from './api/useSubirDocumentoEvento';
export type { SubirDocumentoEventoVars } from './api/useSubirDocumentoEvento';
export { normalizarErrorSubirDocumento } from './api/normalizarError';
export {
  permiteSubirDocumentacion,
  debeMostrarSeccionDocumentacion,
} from './lib/estado';
export {
  validarDocumento,
  acceptPorTipo,
  mimesPorTipo,
  formatearTamano,
  ETIQUETA_TIPO,
  AYUDA_TIPO,
  ORDEN_TIPOS,
  MIME_PERMITIDOS,
  MAX_BYTES_DOCUMENTO,
} from './lib/fichero';
export type {
  TipoDocumentoEvento,
  DocumentoEvento,
  ChecklistItemDocumentacionEvento,
  ChecklistDocumentacionEvento,
  SubirDocumentoEventoResponse,
  SubirDocumentoEventoError,
} from './model/types';
