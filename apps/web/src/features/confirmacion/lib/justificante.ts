/**
 * Validación de cliente del fichero justificante de pago (US-021 · UC-17). La
 * autoritativa es la del servidor (422 FORMATO_NO_PERMITIDO / TAMANO_EXCEDIDO /
 * JUSTIFICANTE_REQUERIDO); esta da feedback inmediato en la UI para no gastar un
 * round-trip cuando el formato/tamaño ya es inválido en el navegador. Los límites
 * (mime permitidos, 10 MB) reflejan la spec-delta de `confirmacion`.
 */

/** MIME types aceptados por el contrato: JPEG, PNG y PDF. */
export const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** Extensiones aceptadas, para el atributo `accept` del input de fichero. */
export const ACCEPT_JUSTIFICANTE = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';

/** Tamaño máximo del justificante: 10 MB. */
export const MAX_BYTES_JUSTIFICANTE = 10 * 1024 * 1024;

/** Mensajes literales alineados con la spec-delta de US-021. */
export const MENSAJE_JUSTIFICANTE_REQUERIDO =
  'Es obligatorio adjuntar el justificante de pago';
export const MENSAJE_FORMATO_NO_PERMITIDO =
  'Formato de fichero no permitido. Adjunta un JPG, PNG o PDF.';
export const MENSAJE_TAMANO_EXCEDIDO =
  'El fichero supera el tamaño máximo permitido (10 MB).';

/**
 * Resultado de la validación de cliente: `null` cuando el fichero es válido, o el
 * mensaje de error en español a mostrar en el formulario.
 */
export const validarJustificante = (fichero: File | null | undefined): string | null => {
  if (!fichero) return MENSAJE_JUSTIFICANTE_REQUERIDO;
  const mimeOk = MIME_PERMITIDOS.some((mime) => mime === fichero.type);
  if (!mimeOk) return MENSAJE_FORMATO_NO_PERMITIDO;
  if (fichero.size > MAX_BYTES_JUSTIFICANTE) return MENSAJE_TAMANO_EXCEDIDO;
  return null;
};

/** Formatea un tamaño en bytes a una etiqueta legible (KB/MB) para la UI. */
export const formatearTamano = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
