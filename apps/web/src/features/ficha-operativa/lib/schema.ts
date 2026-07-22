import { z } from 'zod';
import type { FichaOperativa, GuardarFichaOperativaRequest } from '../model/types';

const MENSAJE_ENTERO_NO_NEGATIVO = 'Introduce un número entero igual o mayor que 0';
const MENSAJE_PRECIO_POSITIVO = 'Introduce un importe válido mayor que 0';

/** Valida cadena vacía o entero ≥ 0 (los inputs controlados devuelven `string`). */
const enteroNoNegativoOpcional = z
  .string()
  .refine(
    (v) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number.isInteger(Number(v.trim()))),
    MENSAJE_ENTERO_NO_NEGATIVO,
  );

/**
 * Schema del formulario de la ficha operativa (US-025 · [reserva-viva]). Todos los
 * campos son opcionales (guardado parcial). En el formulario todo se maneja como
 * cadena de texto (los inputs controlados devuelven `string`).
 *
 * El aforo ESTRUCTURAL viaja ahora desglosado en `numAdultosNinosMayores4` (≥ 4 años,
 * determina el tramo de tarifa) y `numNinosMenores4` (< 4 años). El nº de personas
 * total es un valor DERIVADO de solo lectura (no se envía como aforo estructural). La
 * duración es un enum `{4,8,12}`. `precioManualEur` solo aplica en `tarifaAConsultar`.
 * El servidor es la fuente de verdad y revalida de forma defensiva.
 */
export const esquemaFicha = z.object({
  numAdultosNinosMayores4: enteroNoNegativoOpcional,
  numNinosMenores4: enteroNoNegativoOpcional,
  duracionHoras: z.enum(['', '4', '8', '12']),
  precioManualEur: z
    .string()
    .refine(
      (v) => v.trim() === '' || (Number.isFinite(Number(v.trim())) && Number(v.trim()) > 0),
      MENSAJE_PRECIO_POSITIVO,
    ),
  contactoEventoNombre: z.string(),
  contactoEventoTelefono: z.string(),
  contactoEventoCorreo: z.string(),
  horaLlegada: z.string(),
  notasOperativas: z.string(),
  briefingEquipo: z.string(),
});

export type FormularioFicha = z.infer<typeof esquemaFicha>;

const enteroDesde = (v: string): number => {
  const t = v.trim();
  return t === '' ? 0 : Number(t);
};

/**
 * Nº de personas DERIVADO que se muestra read-only, replicando la regla
 * `derivarNumPersonas` del backend: `numInvitadosFinal ?? (adultos + niños < 4)`
 * (nulls como 0). No se envía al servidor; el backend lo recalcula.
 */
export const numPersonasDerivado = (valores: FormularioFicha): number =>
  enteroDesde(valores.numAdultosNinosMayores4) + enteroDesde(valores.numNinosMenores4);

/** Valores del formulario a partir de una `FichaOperativa` cargada (o vacíos). */
export const valoresDesdeFicha = (ficha?: FichaOperativa | null): FormularioFicha => ({
  numAdultosNinosMayores4:
    ficha?.numAdultosNinosMayores4 != null ? String(ficha.numAdultosNinosMayores4) : '',
  numNinosMenores4: ficha?.numNinosMenores4 != null ? String(ficha.numNinosMenores4) : '',
  duracionHoras: ficha?.duracionHoras != null ? (String(ficha.duracionHoras) as '4' | '8' | '12') : '',
  precioManualEur: '',
  contactoEventoNombre: ficha?.contactoEventoNombre ?? '',
  contactoEventoTelefono: ficha?.contactoEventoTelefono ?? '',
  contactoEventoCorreo: ficha?.contactoEventoCorreo ?? '',
  horaLlegada: ficha?.horaLlegada ?? '',
  notasOperativas: ficha?.notasOperativas ?? '',
  briefingEquipo: ficha?.briefingEquipo ?? '',
});

const textoONull = (v: string): string | null => {
  const t = v.trim();
  return t === '' ? null : t;
};

const enteroONull = (v: string): number | null => {
  const t = v.trim();
  return t === '' ? null : Number(t);
};

/**
 * Construye el cuerpo del PATCH a partir de los valores del formulario. El backend
 * hace guardado parcial; enviamos el aforo ESTRUCTURAL desglosado y la duración enum
 * (no el `numInvitadosConfirmado` derivado, deprecado como fuente de aforo). Los
 * campos de texto vacíos se envían como `null` para permitir borrar.
 *
 * `precioManualEur` solo se incluye si el gestor lo introdujo (caso `tarifaAConsultar`).
 */
export const construirRequest = (valores: FormularioFicha): GuardarFichaOperativaRequest => {
  const precioManual = valores.precioManualEur.trim();
  return {
    numAdultosNinosMayores4: enteroONull(valores.numAdultosNinosMayores4),
    numNinosMenores4: enteroONull(valores.numNinosMenores4),
    duracionHoras:
      valores.duracionHoras === ''
        ? null
        : (Number(valores.duracionHoras) as 4 | 8 | 12),
    ...(precioManual !== '' ? { precioManualEur: precioManual } : {}),
    contactoEventoNombre: textoONull(valores.contactoEventoNombre),
    contactoEventoTelefono: textoONull(valores.contactoEventoTelefono),
    contactoEventoCorreo: textoONull(valores.contactoEventoCorreo),
    horaLlegada: textoONull(valores.horaLlegada),
    notasOperativas: textoONull(valores.notasOperativas),
    briefingEquipo: textoONull(valores.briefingEquipo),
  };
};
