/**
 * Validación de cliente del fichero justificante de pago del dominio de facturación
 * (US-036 · devolución de fianza; espejo de `confirmacion/lib/justificante.ts` de US-021).
 * La validación autoritativa es la del servidor (`POST /documentos` revalida formato/tamaño);
 * esta da feedback inmediato en la UI para no gastar un round-trip cuando el fichero ya es
 * inválido en el navegador. Los límites (MIME permitidos, 10 MB) reflejan el endpoint de
 * subida de documentos.
 */

/** MIME types aceptados por el contrato: JPEG, PNG y PDF. */
export const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** Extensiones/MIME aceptados, para el atributo `accept` del input de fichero. */
export const ACCEPT_JUSTIFICANTE = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';

/** Tamaño máximo del justificante: 10 MB. */
export const MAX_BYTES_JUSTIFICANTE = 10 * 1024 * 1024;

export const MENSAJE_FORMATO_NO_PERMITIDO =
  'Formato de fichero no permitido. Adjunta un JPG, PNG o PDF.';
export const MENSAJE_TAMANO_EXCEDIDO =
  'El fichero supera el tamaño máximo permitido (10 MB).';

/**
 * Valida el fichero adjunto (opcional en US-036, FA-04): `null` cuando es válido —incluido el
 * caso de "sin fichero", que aquí es aceptable—, o el mensaje de error en español a mostrar.
 * A diferencia de US-021, la ausencia de fichero NO es error (el justificante es opcional).
 */
export const validarJustificante = (fichero: File | null | undefined): string | null => {
  if (!fichero) return null;
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
