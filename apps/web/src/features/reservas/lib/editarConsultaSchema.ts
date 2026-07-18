/**
 * Esquema y mapeo del editor de campos simples de la consulta (US-051 §Punto 2).
 * Espejo en cliente de `UpdateReservaRequest` (SDK) + la validación cruzada de
 * `horario` (§D-1: solo válido con `duracionHoras` presente). La fecha NO entra
 * aquí: se muta por el flujo atómico, nunca por el PATCH. `components/` aloja SOLO
 * `.tsx` (regla dura): schema y helpers viven en `lib/`.
 */
import { z } from 'zod';
import type { components } from '@/api-client';
import type { Reserva, UpdateReservaRequest } from '../model/types';

const DURACIONES = ['4', '8', '12'] as const;
const TIPOS = ['boda', 'corporativo', 'privado', 'cumpleanos', 'otro'] as const;

export const editarConsultaSchema = z
  .object({
    tipoEvento: z.union([z.enum(TIPOS), z.literal('')]),
    duracionHoras: z.union([z.enum(DURACIONES), z.literal('')]),
    // Los recuentos se editan como texto numérico; '' = sin dato.
    numAdultosNinosMayores4: z
      .string()
      .trim()
      .regex(/^\d*$/, 'Introduce un número válido'),
    numNinosMenores4: z.string().trim().regex(/^\d*$/, 'Introduce un número válido'),
    numInvitadosFinal: z.string().trim().regex(/^\d*$/, 'Introduce un número válido'),
    horario: z.union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM')]),
    notas: z.string().max(2000, 'Máximo 2000 caracteres'),
  })
  .refine((data) => data.horario === '' || data.duracionHoras !== '', {
    message: 'El horario requiere seleccionar la duración',
    path: ['horario'],
  });

export type FormularioEditarConsulta = z.infer<typeof editarConsultaSchema>;

/** Valores iniciales del editor a partir de la RESERVA actual. */
export const valoresDeReserva = (reserva: Reserva): FormularioEditarConsulta => ({
  tipoEvento: (reserva.tipoEvento ?? '') as FormularioEditarConsulta['tipoEvento'],
  duracionHoras: reserva.duracionHoras
    ? (String(reserva.duracionHoras) as FormularioEditarConsulta['duracionHoras'])
    : '',
  numAdultosNinosMayores4:
    reserva.numAdultosNinosMayores4 != null ? String(reserva.numAdultosNinosMayores4) : '',
  numNinosMenores4: reserva.numNinosMenores4 != null ? String(reserva.numNinosMenores4) : '',
  numInvitadosFinal: reserva.numInvitadosFinal != null ? String(reserva.numInvitadosFinal) : '',
  horario: reserva.horario ?? '',
  notas: reserva.notas ?? '',
});

const numeroOpcional = (valor: string): number | undefined =>
  valor.trim() === '' ? undefined : Number(valor);

type DuracionHoras = components['schemas']['DuracionHoras'];
type TipoEvento = components['schemas']['TipoEvento'];

/**
 * Construye el body de `UpdateReservaRequest` a partir del formulario. Los campos
 * vacíos se OMITEN (no se envían) para no pisar datos con `undefined`. NUNCA
 * incluye `fechaEvento` (§D-1).
 */
export const aUpdateReservaRequest = (
  valores: FormularioEditarConsulta,
): UpdateReservaRequest => {
  const body: UpdateReservaRequest = {};
  if (valores.tipoEvento !== '') body.tipoEvento = valores.tipoEvento as TipoEvento;
  if (valores.duracionHoras !== '') {
    body.duracionHoras = Number(valores.duracionHoras) as DuracionHoras;
  }
  const adultos = numeroOpcional(valores.numAdultosNinosMayores4);
  if (adultos !== undefined) body.numAdultosNinosMayores4 = adultos;
  const ninos = numeroOpcional(valores.numNinosMenores4);
  if (ninos !== undefined) body.numNinosMenores4 = ninos;
  const finales = numeroOpcional(valores.numInvitadosFinal);
  if (finales !== undefined) body.numInvitadosFinal = finales;
  if (valores.horario !== '') body.horario = valores.horario;
  body.notas = valores.notas;
  return body;
};
