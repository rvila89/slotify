/**
 * Esquemas de validación de cliente (React Hook Form + Zod, regla dura del proyecto)
 * de los formularios de comunicaciones (US-046 · UC-36). El servidor revalida siempre
 * (400/422/502); estos esquemas solo dan feedback inmediato al Gestor.
 *
 * El gestor edita **solo** `asunto`/`cuerpo`: `codigoEmail` y `destinatarioEmail` no
 * son editables (regla de negocio de la US).
 */
import { z } from 'zod';

export const ASUNTO_MAX = 200;
export const CUERPO_MAX = 10_000;

/**
 * Revisión/edición opcional de un borrador antes de enviar: `asunto` y `cuerpo` son
 * OPCIONALES (si no se tocan, el backend usa el original del borrador), pero si se
 * escriben no pueden quedar vacíos ni exceder el límite.
 */
export const esquemaEnviarBorrador = z.object({
  asunto: z
    .string()
    .trim()
    .min(1, 'El asunto no puede quedar vacío.')
    .max(ASUNTO_MAX, `El asunto no puede superar los ${ASUNTO_MAX} caracteres.`),
  cuerpo: z
    .string()
    .trim()
    .min(1, 'El cuerpo del email no puede quedar vacío.')
    .max(CUERPO_MAX, `El cuerpo no puede superar los ${CUERPO_MAX} caracteres.`),
});

export type FormularioEnviarBorrador = z.infer<typeof esquemaEnviarBorrador>;

/** Email manual: `asunto` y `cuerpo` OBLIGATORIOS (no hay original que heredar). */
export const esquemaEmailManual = z.object({
  asunto: z
    .string()
    .trim()
    .min(1, 'Indica el asunto del email.')
    .max(ASUNTO_MAX, `El asunto no puede superar los ${ASUNTO_MAX} caracteres.`),
  cuerpo: z
    .string()
    .trim()
    .min(1, 'Escribe el cuerpo del email.')
    .max(CUERPO_MAX, `El cuerpo no puede superar los ${CUERPO_MAX} caracteres.`),
});

export type FormularioEmailManual = z.infer<typeof esquemaEmailManual>;
