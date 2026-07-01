import type { ColorCalendario } from '../model/types';

/**
 * Mapa declarativo `color → clases Tailwind` (US-039 §11.3, design §D-2). El
 * backend emite el nombre lógico del color derivado del par (estado, subEstado);
 * el frontend solo lo traduce a tokens del proyecto (`cal-*` en index.css /
 * tailwind.config.ts), nunca hex inline. El color es IDÉNTICO en todas las
 * vistas (mes/semana/día/lista) porque deriva de esta única tabla.
 *
 * Tabla de datos, no condicionales dispersos (coherente con "estados como
 * estructura de datos" del CLAUDE.md).
 */
type EstiloColor = {
  /** Clases de relleno + texto para el evento/celda (vista mes/semana/día). */
  evento: string;
  /** Punto/badge tonal para listados y la leyenda. */
  punto: string;
  /** Etiqueta legible del estado para leyenda y lectores de pantalla. */
  etiqueta: string;
};

export const ESTILO_COLOR: Record<ColorCalendario, EstiloColor> = {
  gris: {
    evento: 'bg-cal-gris text-cal-gris-foreground',
    punto: 'bg-cal-gris',
    etiqueta: 'Consulta activa',
  },
  ambar: {
    evento: 'bg-cal-ambar text-cal-ambar-foreground',
    punto: 'bg-cal-ambar',
    etiqueta: 'Pre-reserva',
  },
  verde: {
    evento: 'bg-cal-verde text-cal-verde-foreground',
    punto: 'bg-cal-verde',
    etiqueta: 'Confirmada / en curso',
  },
  azul: {
    evento: 'bg-cal-azul text-cal-azul-foreground',
    punto: 'bg-cal-azul',
    etiqueta: 'Completada',
  },
  rojo: {
    evento: 'bg-cal-rojo text-cal-rojo-foreground',
    punto: 'bg-cal-rojo',
    etiqueta: 'Cancelada',
  },
};

/** Orden canónico de la leyenda (mismo orden que §11.3). */
export const ORDEN_LEYENDA: ColorCalendario[] = ['gris', 'ambar', 'verde', 'azul', 'rojo'];
