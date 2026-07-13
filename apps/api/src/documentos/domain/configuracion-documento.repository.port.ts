/**
 * Puerto de dominio de lectura de la configuración de documento del tenant
 * (épico #6, rebanada 6.1a `documentos-config-tenant-storage`).
 *
 * Interfaz PURA: la aplicación la consume por token; la infraestructura la
 * implementa con Prisma bajo el RLS del tenant. Sin imports de framework/infra
 * (hook `no-infra-in-domain`).
 */
import type { ConfiguracionDocumentoTenant } from './configuracion-documento';

export interface ConfiguracionDocumentoRepositoryPort {
  /**
   * Devuelve la configuración de documento del `tenantId` dado, o `null` si el
   * tenant aún no tiene configuración.
   */
  obtenerPorTenant(
    tenantId: string,
  ): Promise<ConfiguracionDocumentoTenant | null>;
}
