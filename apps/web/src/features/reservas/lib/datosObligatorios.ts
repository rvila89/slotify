/**
 * Validación de cliente de los datos obligatorios UC-14 requeridos por la
 * transición "Cliente quiere reservar ahora" (US-010, 2.v → pre_reserva). Es el
 * espejo del bloqueo estricto del backend (`DATOS_FISCALES_INCOMPLETOS`,
 * `camposFaltantes`): mismo conjunto de 9 campos y misma semántica de "enumerar
 * faltantes" que UC-14 FA-01.
 *
 * Sirve para un **pre-chequeo en cliente** que muestra al gestor qué falta ANTES
 * de confirmar (y deshabilita la confirmación); el servidor revalida de forma
 * defensiva y devuelve la lista autoritativa en el 422. El nombre del enum
 * (`CampoObligatorio`) deriva del SDK generado — única fuente de verdad; aquí no
 * se inventan campos de API.
 */
import type { components } from '@/api-client';

type ReservaDetalle = components['schemas']['ReservaDetalle'];

/** Enum de campos faltantes tal cual lo declara el contrato (schema del 422). */
export type CampoObligatorio =
  components['schemas']['PresupuestoDatosFiscalesError']['camposFaltantes'][number];

/** Etiquetas legibles en español de cada campo obligatorio (UC-14 FA-01). */
export const ETIQUETA_CAMPO_OBLIGATORIO: Record<CampoObligatorio, string> = {
  dniNif: 'DNI / NIF del cliente',
  direccion: 'Dirección del cliente',
  codigoPostal: 'Código postal del cliente',
  poblacion: 'Población del cliente',
  provincia: 'Provincia del cliente',
  fechaEvento: 'Fecha del evento',
  duracionHoras: 'Duración (horas)',
  numAdultosNinosMayores4: 'Número de invitados (adultos y niños > 4 años)',
  tipoEvento: 'Tipo de evento',
};

const vacio = (valor: unknown): boolean =>
  valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');

/**
 * Calcula, en cliente, la lista de campos obligatorios UC-14 que faltan en la
 * RESERVA (`fechaEvento`, `duracionHoras`, `tipoEvento`, `numAdultosNinosMayores4`)
 * y en el CLIENTE (`dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`).
 * El orden replica el del backend para que el listado sea estable.
 */
export const camposObligatoriosFaltantes = (reserva: ReservaDetalle): CampoObligatorio[] => {
  const cliente = reserva.cliente;
  const faltantes: CampoObligatorio[] = [];

  if (vacio(reserva.fechaEvento)) faltantes.push('fechaEvento');
  if (vacio(reserva.duracionHoras)) faltantes.push('duracionHoras');
  if (vacio(reserva.tipoEvento)) faltantes.push('tipoEvento');
  if (vacio(reserva.numAdultosNinosMayores4)) faltantes.push('numAdultosNinosMayores4');
  if (vacio(cliente?.dniNif)) faltantes.push('dniNif');
  if (vacio(cliente?.direccion)) faltantes.push('direccion');
  if (vacio(cliente?.codigoPostal)) faltantes.push('codigoPostal');
  if (vacio(cliente?.poblacion)) faltantes.push('poblacion');
  if (vacio(cliente?.provincia)) faltantes.push('provincia');

  return faltantes;
};
