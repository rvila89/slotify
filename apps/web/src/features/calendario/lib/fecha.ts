import type { VistaCalendario } from '../model/types';

/**
 * Helpers de fecha del calendario (US-039). Las fechas de rango viajan en
 * formato ISO `YYYY-MM-DD`; el rango lo calcula el frontend según la vista y el
 * período activo (design §D-1), el backend solo agrega sobre `[desde, hasta]`.
 */
const aISODate = (d: Date): string => {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/**
 * Rango `[desde, hasta]` (inclusive) que cubre lo visible para una vista y un
 * `date` ancla. Para "mes" se extiende a semanas completas (lunes-domingo) para
 * cubrir el desbordamiento de la rejilla mensual de react-big-calendar; el resto
 * de vistas usan su período natural. Margen amplio = el backend solo devuelve
 * fechas ocupadas, así que sobre-pedir no infla la respuesta.
 */
export const rangoDeVista = (date: Date, vista: VistaCalendario): { desde: string; hasta: string } => {
  const inicio = new Date(date);
  const fin = new Date(date);

  if (vista === 'dia') {
    return { desde: aISODate(inicio), hasta: aISODate(fin) };
  }
  if (vista === 'semana') {
    const diaSemana = (inicio.getDay() + 6) % 7; // lunes = 0
    inicio.setDate(inicio.getDate() - diaSemana);
    fin.setTime(inicio.getTime());
    fin.setDate(inicio.getDate() + 6);
    return { desde: aISODate(inicio), hasta: aISODate(fin) };
  }
  // mes y lista (agenda) → mes natural extendido a semanas completas.
  inicio.setDate(1);
  const diaSemanaInicio = (inicio.getDay() + 6) % 7;
  inicio.setDate(inicio.getDate() - diaSemanaInicio);
  fin.setMonth(fin.getMonth() + 1, 0); // último día del mes
  const diaSemanaFin = (fin.getDay() + 6) % 7;
  fin.setDate(fin.getDate() + (6 - diaSemanaFin));
  return { desde: aISODate(inicio), hasta: aISODate(fin) };
};

/** Convierte una fecha ISO `YYYY-MM-DD` a `Date` local sin desfase de TZ. */
export const desdeISODate = (iso: string): Date => new Date(`${iso}T00:00:00`);

/**
 * TTL restante legible desde `ttlExpiracion` (date-time) para el popover. `null`
 * si no hay expiración (bloqueo firme / histórica) o si ya expiró. Devuelve
 * "menos de 1 hora" / "N horas" / "N días" en español.
 */
export const ttlRestante = (ttlExpiracion?: string | null): string | null => {
  if (!ttlExpiracion) return null;
  const expira = new Date(ttlExpiracion).getTime();
  if (!Number.isFinite(expira)) return null;
  const restanteMs = expira - Date.now();
  if (restanteMs <= 0) return null;

  const horas = Math.floor(restanteMs / 3_600_000);
  if (horas < 1) return 'menos de 1 hora';
  if (horas < 24) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
};
