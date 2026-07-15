/**
 * Esquema de validación (Zod) del formulario de EDICIÓN del presupuesto (US-015 ·
 * UC-15). Regla dura del proyecto: formularios con React Hook Form + Zod. Vive en
 * `lib/` (no `components/`) porque es un schema, no un componente. Los campos son
 * strings (inputs no controlados de `number`/`select`) y se validan/normalizan aquí;
 * el server revalida de forma defensiva (422 DESCUENTO_INVALIDO / DURACION_INVALIDA).
 */
import { z } from 'zod';
import {
  MENSAJE_DESCUENTO_INVALIDO,
  MENSAJE_INVITADOS_INVALIDO,
  MENSAJE_PRECIO_MANUAL_NO_NEGATIVO,
} from './edicion';

const enteroPositivoOpcional = (mensaje: string) =>
  z
    .string()
    .refine(
      (v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 1),
      mensaje,
    );

export const esquemaEdicion = z.object({
  // Nº invitados: entero >= 1 o vacío (mantiene el valor actual del presupuesto).
  numInvitados: enteroPositivoOpcional(MENSAJE_INVITADOS_INVALIDO),
  // Duración: siempre uno de {4,8,12} (el <select> garantiza la opción).
  duracionHoras: z.enum(['4', '8', '12']),
  // Descuento: 0 o superior (el server revalida <= base imponible → 422).
  descuento: z
    .string()
    .refine(
      (v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0),
      MENSAJE_DESCUENTO_INVALIDO,
    ),
  descuentoMotivo: z.string().max(500).optional(),
  // Precio manual (>50 invitados, tarifa a consultar): 0 o superior; obligatorio solo
  // cuando `tarifaAConsultar=true` (esa comprobación se hace en el diálogo al enviar).
  precioManual: z
    .string()
    .refine(
      (v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0),
      MENSAJE_PRECIO_MANUAL_NO_NEGATIVO,
    ),
  metodoPago: z.enum(['transferencia', 'efectivo'], {
    required_error: 'Elige un método de pago',
    invalid_type_error: 'Elige un método de pago',
  }),
});

export type FormularioEdicion = z.infer<typeof esquemaEdicion>;
