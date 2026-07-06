import type { components } from '@/api-client';

/**
 * Tipos del dominio Dashboard operativo (US-044). Alias directos sobre los
 * esquemas del cliente generado (`@/api-client`): la fuente de verdad de la
 * forma de los datos es el contrato OpenAPI (`consultarDashboard`), nunca tipos
 * inventados aquí.
 */
export type DashboardResponse = components['schemas']['DashboardResponse'];
export type DashboardWidget = components['schemas']['DashboardWidget'];
export type DashboardProximos30DiasWidget =
  components['schemas']['DashboardProximos30DiasWidget'];
export type DashboardItem = components['schemas']['DashboardItem'];
export type DashboardItemProximos30Dias =
  components['schemas']['DashboardItemProximos30Dias'];

/**
 * Claves de los 7 widgets, tal cual las emite el contrato. Se usa como índice
 * tipado sobre `DashboardResponse` para recorrer los widgets de forma
 * declarativa (tabla de datos, no condicionales dispersos).
 */
export type DashboardWidgetKey = keyof DashboardResponse;
