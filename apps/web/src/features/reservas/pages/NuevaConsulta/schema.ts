import { z } from 'zod';
import { hoyISO } from '../../lib/fecha';
import { CANAL_VALUES, DURACIONES, EMAIL_RE } from './constants';
import type { CanalEntrada } from '../../model/types';

/**
 * Esquema de validación del alta de consulta (US-003/US-004). La fecha es
 * opcional: vacía → consulta exploratoria (2.a); si se indica, debe ser
 * estrictamente futura (`> hoy`), coherente con el servidor (rechaza hoy y
 * pasado). Las fechas `YYYY-MM-DD` comparan lexicográfica == cronológicamente.
 */
export const esquema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(100, 'Máximo 100 caracteres'),
  apellidos: z
    .string()
    .trim()
    .min(1, 'Los apellidos son obligatorios')
    .max(100, 'Máximo 100 caracteres'),
  email: z
    .string()
    .trim()
    .min(1, 'El email es obligatorio')
    .max(254, 'Máximo 254 caracteres')
    .regex(EMAIL_RE, 'Introduce un email válido'),
  telefono: z.string().trim().min(1, 'El teléfono es obligatorio'),
  canalEntrada: z.string().refine((v) => CANAL_VALUES.includes(v as CanalEntrada), {
    message: 'Selecciona un canal de entrada',
  }),
  fechaEvento: z.string().refine((v) => v === '' || v > hoyISO(), {
    message: 'La fecha del evento debe ser posterior a hoy',
  }),
  invitados: z.string().trim().regex(/^\d*$/, 'Introduce un número de invitados válido'),
  duracionHoras: z.union([z.enum(DURACIONES), z.literal('')]),
  idioma: z.enum(['es', 'ca']),
  // Vacío ('') = sin horario indicado; si se rellena debe cumplir HH:MM.
  horario: z.union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM')]),
  tipoEvento: z.union([
    z.enum(['boda', 'corporativo', 'privado', 'otro', 'cumpleanos']),
    z.literal(''),
  ]),
  comentarios: z.string().max(2000, 'Máximo 2000 caracteres'),
}).refine((data) => data.horario === '' || data.duracionHoras !== '', {
  message: 'El horario requiere seleccionar la duración',
  path: ['horario'],
});

export type FormularioConsulta = z.infer<typeof esquema>;

export const valoresIniciales: FormularioConsulta = {
  nombre: '',
  apellidos: '',
  email: '',
  telefono: '',
  canalEntrada: '',
  fechaEvento: '',
  invitados: '',
  duracionHoras: '',
  idioma: 'es',
  horario: '',
  tipoEvento: '',
  comentarios: '',
};
