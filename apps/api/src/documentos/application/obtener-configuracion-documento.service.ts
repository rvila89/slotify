/**
 * Servicio de aplicación: lectura de la configuración de documento del tenant
 * (épico #6, rebanada 6.1a `documentos-config-tenant-storage`).
 *
 * Orquesta la lectura vía el puerto de repositorio inyectado (por token en el
 * módulo). No conoce Prisma ni la BD (hexagonal). El aislamiento por tenant lo
 * garantiza el adaptador Prisma bajo RLS; aquí solo se consulta por `tenantId`.
 * Lo consumirá la rebanada 6.1b al generar el PDF.
 */
import type { ConfiguracionDocumentoRepositoryPort } from '../domain/configuracion-documento.repository.port';
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';

export class ObtenerConfiguracionDocumentoService {
  constructor(private readonly repo: ConfiguracionDocumentoRepositoryPort) {}

  async ejecutar(
    tenantId: string,
  ): Promise<ConfiguracionDocumentoTenant | null> {
    return this.repo.obtenerPorTenant(tenantId);
  }
}
