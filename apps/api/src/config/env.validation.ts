/**
 * Validación del entorno con zod.
 *
 * Se ejecuta en bootstrap (vía `ConfigModule.forRoot({ validate })`). Si falta
 * una variable obligatoria o `JWT_ACCESS_SECRET` es vacío o < 32 caracteres, el
 * arranque FALLA con un mensaje explícito indicando la variable culpable.
 */
import { z } from 'zod';

const esquemaEntorno = z.object({
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL es obligatoria' })
    .min(1, 'DATABASE_URL no puede estar vacía'),
  JWT_ACCESS_SECRET: z
    .string({ required_error: 'JWT_ACCESS_SECRET es obligatoria' })
    .min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_URL: z.string().default('http://localhost:5173'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  CRON_TOKEN: z.string().optional(),
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
