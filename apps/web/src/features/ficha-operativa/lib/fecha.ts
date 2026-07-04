/**
 * Formatea una fecha-hora ISO (date-time) del contrato a texto en español con día,
 * mes, año y hora (para la fecha de cierre de la ficha, US-025). El backend es la
 * fuente de verdad del instante; aquí solo se presenta en zona local del navegador.
 */
export const formatearFechaHoraCierre = (iso: string): string =>
  new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
