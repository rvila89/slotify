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
