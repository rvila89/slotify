import type { CampoFiscalFaltante } from '../model/types';

/**
 * Utilidades de los campos fiscales del CLIENTE (US-014 · incidencia #5), separadas del
 * componente de la sección para no romper `react-refresh/only-export-components` (un
 * archivo de componente solo debe exportar componentes). El `camposFaltantes[]` del
 * contrato mezcla campos fiscales del CLIENTE y de la RESERVA; aquí filtramos solo los
 * 5 fiscales que la sección puede completar inline.
 */
export type CampoFiscalCliente =
  | 'dniNif'
  | 'direccion'
  | 'codigoPostal'
  | 'poblacion'
  | 'provincia';

/** Solo los campos fiscales del CLIENTE (subconjunto de `CampoFiscalFaltante`). */
export const CAMPOS_FISCALES: readonly CampoFiscalCliente[] = [
  'dniNif',
  'direccion',
  'codigoPostal',
  'poblacion',
  'provincia',
] as const;

const esCampoFiscal = (campo: CampoFiscalFaltante): campo is CampoFiscalCliente =>
  (CAMPOS_FISCALES as readonly string[]).includes(campo);

/** Extrae de `camposFaltantes` solo los fiscales del CLIENTE que gestiona la sección. */
export const camposFiscalesFaltantes = (
  camposFaltantes: readonly CampoFiscalFaltante[],
): CampoFiscalCliente[] => camposFaltantes.filter(esCampoFiscal);

/** Cliente con (al menos) los 5 campos fiscales opcionales que evalúa el presupuesto. */
type ClienteFiscal = Partial<Record<CampoFiscalCliente, string | null>> | null | undefined;

/**
 * `true` si al cliente le falta alguno de los 5 campos fiscales (vacío o ausente). Fija
 * la visibilidad del botón "Solicitar datos al cliente" del modal de presupuesto (change
 * solicitud-datos-presupuesto-borrador), reutilizando la misma validación
 * `DATOS_FISCALES_INCOMPLETOS` que el bucle de resolución D-5.
 */
export const datosFiscalesIncompletos = (cliente: ClienteFiscal): boolean =>
  CAMPOS_FISCALES.some((campo) => {
    const valor = cliente?.[campo];
    return valor == null || valor.trim() === '';
  });
