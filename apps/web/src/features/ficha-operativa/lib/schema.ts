import { z } from 'zod';
import type { FichaOperativa, GuardarFichaOperativaRequest } from '../model/types';

const MENSAJE_INVITADOS =
  'El nº de invitados confirmado debe ser un entero igual o mayor que 0';

/**
 * Schema del formulario de la ficha operativa (US-025). Todos los campos son
 * opcionales (guardado parcial). En el formulario todos se manejan como cadena de
 * texto (los inputs controlados devuelven `string`); `numInvitadosConfirmado` valida
 * que, si trae contenido, sea un entero ≥ 0. El servidor es la fuente de verdad y
 * revalida de forma defensiva.
 */
export const esquemaFicha = z.object({
  numInvitadosConfirmado: z
    .string()
    .refine(
      (v) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number.isInteger(Number(v.trim()))),
      MENSAJE_INVITADOS,
    ),
  menuSeleccionado: z.string(),
  timingDetallado: z.string(),
  contactoEventoNombre: z.string(),
  contactoEventoTelefono: z.string(),
  notasOperativas: z.string(),
  briefingEquipo: z.string(),
});

export type FormularioFicha = z.infer<typeof esquemaFicha>;

/** Valores del formulario a partir de una `FichaOperativa` cargada (o vacíos). */
export const valoresDesdeFicha = (ficha?: FichaOperativa | null): FormularioFicha => ({
  numInvitadosConfirmado:
    ficha?.numInvitadosConfirmado != null ? String(ficha.numInvitadosConfirmado) : '',
  menuSeleccionado: ficha?.menuSeleccionado ?? '',
  timingDetallado: ficha?.timingDetallado ?? '',
  contactoEventoNombre: ficha?.contactoEventoNombre ?? '',
  contactoEventoTelefono: ficha?.contactoEventoTelefono ?? '',
  notasOperativas: ficha?.notasOperativas ?? '',
  briefingEquipo: ficha?.briefingEquipo ?? '',
});

const textoONull = (v: string): string | null => {
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * Construye el cuerpo del PATCH a partir de los valores del formulario. El backend
 * hace guardado parcial; enviamos todos los campos de contenido (los vacíos como
 * `null` para permitir borrar), con `numInvitadosConfirmado` como entero o `null`.
 */
export const construirRequest = (
  valores: FormularioFicha,
): GuardarFichaOperativaRequest => {
  const invitados = valores.numInvitadosConfirmado.trim();
  return {
    numInvitadosConfirmado: invitados === '' ? null : Number(invitados),
    menuSeleccionado: textoONull(valores.menuSeleccionado),
    timingDetallado: textoONull(valores.timingDetallado),
    contactoEventoNombre: textoONull(valores.contactoEventoNombre),
    contactoEventoTelefono: textoONull(valores.contactoEventoTelefono),
    notasOperativas: textoONull(valores.notasOperativas),
    briefingEquipo: textoONull(valores.briefingEquipo),
  };
};
