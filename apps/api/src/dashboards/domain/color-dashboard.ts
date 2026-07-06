/**
 * Derivación del COLOR de los ítems del widget "Próximos 30 días" del dashboard
 * (US-044, design.md §D-2). REUTILIZA la función pura `derivarColor` del módulo
 * `calendario` (US-039 / §11.3) — única fuente de verdad del código cromático, sin
 * duplicar el mapa. Hexagonal: dominio puro, no importa `@nestjs/*` ni infraestructura.
 */
import {
  derivarColor,
  type ColorCalendario,
} from '../../calendario/domain/derivacion-color';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

export type { ColorCalendario };

/**
 * Deriva el color canónico de una reserva del dashboard con la MISMA función que el
 * Calendario. Devuelve `null` cuando el par `(estado, subEstado)` no tiene color
 * (consulta terminal 2x/2y/2z): esos ítems no se pintan y el widget los descarta.
 */
export const derivarColorDashboard = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ColorCalendario | null => derivarColor(estado, subEstado);
