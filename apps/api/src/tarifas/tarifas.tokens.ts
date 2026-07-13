/**
 * Tokens de inyección (Symbol) de los puertos del motor de tarifa.
 *
 * Viven fuera del dominio: son detalle de wiring de NestJS. El dominio depende
 * solo de las interfaces (puertos); la infraestructura las implementa y se
 * enlazan a estos tokens en el módulo.
 */
export const TEMPORADA_CALENDARIO_PORT = Symbol('TemporadaCalendarioPort');
export const TARIFA_REPOSITORY_PORT = Symbol('TarifaRepositoryPort');
export const EXTRA_REPOSITORY_PORT = Symbol('ExtraRepositoryPort');
export const CATALOGO_EXTRAS_PORT = Symbol('CatalogoExtrasPort');
export const CLOCK_PORT = Symbol('ClockPort');
