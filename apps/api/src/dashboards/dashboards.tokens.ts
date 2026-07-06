/**
 * Tokens de inyección (Symbol) del módulo dashboards (US-044). Viven fuera del dominio
 * (wiring de infraestructura): enlazan cada puerto a su adaptador en el módulo Nest.
 */
export const DASHBOARD_QUERY_PORT = Symbol('DashboardQueryPort');
export const CLOCK_PORT = Symbol('ClockPort');
