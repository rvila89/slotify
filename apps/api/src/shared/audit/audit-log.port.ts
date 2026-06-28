/**
 * Puerto de auditoría COMPARTIDO (`AuditLogPort`).
 *
 * Extraído desde `reservas/domain/liberar-fecha.service.ts` (US-041) a una
 * ubicación transversal para que tanto `reservas` (liberación de fecha) como
 * `auth` (login/logout) registren en `AUDIT_LOG` a través del MISMO puerto, sin
 * duplicar la interfaz (decisión §6 del design de US-001).
 *
 * Es un PUERTO de dominio (interfaz pura): no importa `@nestjs/*`, Prisma ni
 * infraestructura, de modo que `domain/` pueda depender de él respetando el hook
 * `no-infra-in-domain`. El adaptador Prisma vive en infraestructura.
 *
 * El puerto es genérico en el tipo de registro (`R`): cada capability define su
 * propio registro tipado (p. ej. `RegistroAuditoriaLiberacion` en reservas) que
 * EXTIENDE `RegistroAuditoria`, conservando el contrato común (`tenantId`,
 * `accion`) y añadiendo su detalle.
 */

/** Acciones auditables conocidas (alineadas con el enum `AccionAudit` de Prisma). */
export type AccionAuditoria =
  | 'crear'
  | 'actualizar'
  | 'eliminar'
  | 'transicion'
  | 'login'
  | 'logout';

/**
 * Registro mínimo de auditoría compartido. Las capabilities lo extienden con sus
 * campos específicos; aquí solo vive el contrato transversal.
 */
export interface RegistroAuditoria {
  tenantId: string;
  accion: AccionAuditoria;
  entidad?: string;
  entidadId?: string;
  usuarioId?: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Puerto de auditoría compartido. La infraestructura lo implementa con un adaptador
 * Prisma; el dominio/aplicación solo invoca `registrar`.
 */
export interface AuditLogPort<R extends RegistroAuditoria = RegistroAuditoria> {
  registrar(registro: R): Promise<void>;
}
