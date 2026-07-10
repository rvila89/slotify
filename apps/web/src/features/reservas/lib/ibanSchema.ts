import { z } from 'zod';
import { esIbanValido, normalizarIban } from './iban';

/**
 * Esquema de validación del formulario de IBAN de devolución (US-035, FA-01). Valida
 * en cliente por checksum mod-97 para UX inmediata; el backend revalida (422) y es la
 * fuente de verdad. El valor se normaliza (mayúsculas, sin espacios) en la transform
 * para enviarlo limpio y coherente con lo que persiste el servidor.
 */
export const ibanFormSchema = z.object({
  iban: z
    .string()
    .trim()
    .min(1, 'El IBAN es obligatorio')
    .transform(normalizarIban)
    .refine(esIbanValido, {
      message:
        'El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud.',
    }),
});

/** Entrada del formulario antes de la transform (lo que teclea el gestor). */
export type IbanFormInput = z.input<typeof ibanFormSchema>;
/** Salida validada y normalizada del formulario. */
export type IbanFormOutput = z.output<typeof ibanFormSchema>;
