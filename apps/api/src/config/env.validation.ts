/**
 * Validación del entorno con zod.
 *
 * Se ejecuta en bootstrap (vía `ConfigModule.forRoot({ validate })`). Si falta
 * una variable obligatoria o `JWT_ACCESS_SECRET` es vacío o < 32 caracteres, el
 * arranque FALLA con un mensaje explícito indicando la variable culpable.
 */
import { z } from 'zod';

const esquemaEntorno = z
  .object({
    DATABASE_URL: z
      .string({ required_error: 'DATABASE_URL es obligatoria' })
      .min(1, 'DATABASE_URL no puede estar vacía'),
    JWT_ACCESS_SECRET: z
      .string({ required_error: 'JWT_ACCESS_SECRET es obligatoria' })
      .min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('5m'),
    JWT_REFRESH_SECRET: z.string().min(32).optional(),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_URL: z.string().default('http://localhost:5173'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    CRON_TOKEN: z.string().optional(),
    // US-045 — motor de email automático (transporte + secretos por entorno).
    // En `test`/CI el transporte es FAKE por defecto (cero envíos reales).
    EMAIL_TRANSPORT: z.enum(['resend', 'fake']).default('fake'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    // DEFAULT SEGURO (Bj3): si NO se setea explícitamente, sandbox = true (no se
    // envían correos reales). El envío real es opt-in EXPLÍCITO con
    // `EMAIL_SANDBOX=false`. Por eso unset → true y solo el literal 'false'
    // desactiva el sandbox.
    EMAIL_SANDBOX: z
      .enum(['true', 'false'])
      .optional()
      .transform((valor) => valor !== 'false'),
    // Épico #6 (6.1a) — selección del adaptador de `AlmacenDocumentosPort`.
    // Decisión B1: en 6.1a solo se implementa `local` (dev/local, sin
    // credenciales cloud); `s3` queda reservado para cuando haya bucket.
    ALMACEN_PROVIDER: z.enum(['local', 's3']).default('local'),
    // Base URL pública del adaptador local (dev). Las claves cuelgan de aquí.
    ALMACEN_LOCAL_BASE_URL: z.string().default('http://localhost:3000/almacen'),
    // Épico #6 (6.5) — directorio en disco donde el adaptador local DURABLE
    // persiste los ficheros (logos/, presupuestos/, facturas/, condiciones/).
    // La ruta estática `GET /almacen/*` (@nestjs/serve-static) lo sirve.
    ALMACEN_LOCAL_DIR: z.string().default('.almacen'),
  })
  .superRefine((entorno, ctx) => {
    // En PRODUCCIÓN el transporte DEBE ser `resend`: un deploy no puede arrancar con
    // `fake` (silenciosamente sin enviar correos). En `test`/CI el default es `fake`
    // (cero red); en `development` se permite cualquiera de los dos.
    if (entorno.NODE_ENV === 'production' && entorno.EMAIL_TRANSPORT !== 'resend') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_TRANSPORT'],
        message:
          'EMAIL_TRANSPORT debe ser "resend" en producción (no se permite "fake")',
      });
    }
    // Configuración condicional: con transporte `resend` son obligatorios la clave
    // de API y el remitente verificado (el arranque corta si faltan).
    if (entorno.EMAIL_TRANSPORT === 'resend') {
      if (!entorno.RESEND_API_KEY || entorno.RESEND_API_KEY.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY es obligatoria cuando EMAIL_TRANSPORT=resend',
        });
      }
      if (!entorno.EMAIL_FROM || entorno.EMAIL_FROM.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM es obligatoria cuando EMAIL_TRANSPORT=resend',
        });
      }
    }
  });

export type EntornoValidado = z.infer<typeof esquemaEntorno>;

/**
 * Valida y normaliza las variables de entorno. Lanza un Error con mensaje
 * explícito si la configuración es inválida (corta el bootstrap).
 */
export const validarEntorno = (
  configuracion: Record<string, unknown>,
): EntornoValidado => {
  const resultado = esquemaEntorno.safeParse(configuracion);
  if (!resultado.success) {
    const detalles = resultado.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuración de entorno inválida:\n${detalles}`,
    );
  }
  return resultado.data;
};
