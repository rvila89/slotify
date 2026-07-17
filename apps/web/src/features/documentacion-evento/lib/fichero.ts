/**
 * Validación de cliente y metadatos de presentación de la documentación
 * obligatoria del evento (US-033 · UC-24). La validación autoritativa es la del
 * servidor (422 FORMATO_NO_PERMITIDO / ARCHIVO_INVALIDO / ARCHIVO_REQUERIDO /
 * TAMANO_EXCEDIDO); esta da feedback inmediato en la UI para no gastar un
 * round-trip cuando el formato/tamaño ya es inválido en el navegador. Los límites
 * (mime permitidos, 10 MB) reflejan la spec-delta de `documentacion-evento`.
 */
import type { TipoDocumentoEvento } from '../model/types';

/** MIME types aceptados por el contrato: JPEG, PNG y PDF. */
export const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** MIME de imagen (fotos de DNI): solo JPEG/PNG, sin PDF. */
export const MIME_IMAGEN = ['image/jpeg', 'image/png'] as const;

/** Tamaño máximo del documento del evento: 10 MB. */
export const MAX_BYTES_DOCUMENTO = 10 * 1024 * 1024;

/**
 * Atributo `accept` para las fotos de DNI: solo imagen (JPEG/PNG). En móvil,
 * combinado con `capture`, ofrece la cámara trasera.
 */
export const ACCEPT_IMAGEN = 'image/jpeg,image/png,.jpg,.jpeg,.png';

/**
 * Atributo `accept` para la cláusula de responsabilidad: admite además PDF (el
 * documento firmado suele escanearse o exportarse a PDF).
 */
export const ACCEPT_CLAUSULA = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';

/** Mensajes literales alineados con la spec-delta de US-033 (§Formato no admitido). */
export const MENSAJE_ARCHIVO_REQUERIDO = 'Es obligatorio adjuntar un archivo.';
export const MENSAJE_FORMATO_NO_PERMITIDO =
  'Formato no admitido. Por favor, usa JPEG, PNG o PDF.';
export const MENSAJE_ARCHIVO_INVALIDO =
  'El archivo no pudo procesarse. Por favor, inténtalo de nuevo con un archivo válido.';
export const MENSAJE_TAMANO_EXCEDIDO =
  'El archivo supera el tamaño máximo permitido (10 MB).';

/** Etiquetas legibles de cada tipo obligatorio, para el checklist. */
export const ETIQUETA_TIPO: Record<TipoDocumentoEvento, string> = {
  dni_anverso: 'DNI anverso',
  dni_reverso: 'DNI reverso',
  clausula_responsabilidad: 'Cláusula de responsabilidad firmada',
};

/** Descripción/ayuda de cada tipo, para el subtítulo de cada ítem del checklist. */
export const AYUDA_TIPO: Record<TipoDocumentoEvento, string> = {
  dni_anverso: 'Foto de la cara frontal del DNI (JPEG o PNG).',
  dni_reverso: 'Foto de la cara trasera del DNI (JPEG o PNG).',
  clausula_responsabilidad: 'Documento firmado por el cliente (JPEG, PNG o PDF).',
};

/**
 * Orden estable de los tres tipos obligatorios para pintar el checklist con
 * independencia del orden que devuelva el backend.
 */
export const ORDEN_TIPOS: readonly TipoDocumentoEvento[] = [
  'dni_anverso',
  'dni_reverso',
  'clausula_responsabilidad',
] as const;

/**
 * MIME admitidos por tipo: las fotos de DNI solo aceptan imagen; la cláusula
 * también PDF. La validación de servidor es la autoritativa.
 */
export const mimesPorTipo = (tipo: TipoDocumentoEvento): readonly string[] =>
  tipo === 'clausula_responsabilidad' ? MIME_PERMITIDOS : MIME_IMAGEN;

/** Atributo `accept` del input de fichero según el tipo. */
export const acceptPorTipo = (tipo: TipoDocumentoEvento): string =>
  tipo === 'clausula_responsabilidad' ? ACCEPT_CLAUSULA : ACCEPT_IMAGEN;

/**
 * Resultado de la validación de cliente: `null` cuando el fichero es válido, o el
 * mensaje de error en español a mostrar. Los formatos permitidos dependen del
 * `tipo` (las fotos de DNI no admiten PDF).
 */
export const validarDocumento = (
  fichero: File | null | undefined,
  tipo: TipoDocumentoEvento,
): string | null => {
  if (!fichero) return MENSAJE_ARCHIVO_REQUERIDO;
  const permitidos = mimesPorTipo(tipo);
  if (!permitidos.some((mime) => mime === fichero.type)) return MENSAJE_FORMATO_NO_PERMITIDO;
  if (fichero.size === 0) return MENSAJE_ARCHIVO_INVALIDO;
  if (fichero.size > MAX_BYTES_DOCUMENTO) return MENSAJE_TAMANO_EXCEDIDO;
  return null;
};

/** Formatea un tamaño en bytes a una etiqueta legible (KB/MB) para la UI. */
export const formatearTamano = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
