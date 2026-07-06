/**
 * Puerto de RELOJ (DOMINIO) del dashboard (US-044, design.md §D-3). Las ventanas
 * temporales (hoy/mañana, [hoy, hoy+30], próximas 24 h) se calculan con la fecha que
 * llega por este puerto, evitando el off-by-one de TZ y permitiendo un reloj fijo en
 * los tests. Hexagonal: no importa `@nestjs/*` ni infraestructura.
 */
export interface ClockPort {
  /** Instante actual. */
  ahora(): Date;
}
