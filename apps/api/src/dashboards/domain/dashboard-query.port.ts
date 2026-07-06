/**
 * Puerto de LECTURA del dashboard (DOMINIO, US-044 / UC-34). Entrega el dataset
 * agregado de reservas del tenant; el adaptador Prisma filtra SIEMPRE por `tenant_id`
 * (del JWT) + `activo = true` y refuerza con RLS (design.md §D-4). LECTURA PURA
 * (§D-5): no muta estado. Hexagonal: no importa `@nestjs/*` ni infraestructura.
 */
import type { DashboardDataset } from './dashboard.types';

/** Parámetros de la agregación del dashboard. */
export interface AgregarDashboardParams {
  /** Tenant del gestor (del JWT, nunca del cliente — §D-4). */
  tenantId: string;
  /** Instante actual (del reloj inyectado — §D-3). */
  ahora: Date;
}

export interface DashboardQueryPort {
  /** Agrega el dataset de reservas activas del tenant para el instante dado. */
  agregar(params: AgregarDashboardParams): Promise<DashboardDataset>;
}
