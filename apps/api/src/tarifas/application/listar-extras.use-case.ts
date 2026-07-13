/**
 * QUERY de APLICACIÓN: listar el catálogo de EXTRAS activos del tenant
 * (`GET /extras` → `Extra[]`, US-014). Alimenta el selector de extras del borrador
 * de presupuesto en el frontend.
 *
 * SOLO LECTURA: no abre transacción de escritura, no toca la máquina de estados ni
 * registra AUDIT_LOG. Delega en el puerto `CatalogoExtrasPort`; el `tenantId`
 * SIEMPRE llega del JWT (nunca del path/body). El filtrado multi-tenant/RLS y el
 * orden los aplica el adaptador detrás del puerto.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO del puerto inyectado; no
 * importa Prisma ni `@nestjs/*`.
 */
import type { CatalogoExtrasPort, ExtraCatalogoItem } from '../domain/catalogo-extras.port';

// Re-export del read-model del puerto como API de la capa de aplicación
// (controllers/tests importan desde aquí sin acoplarse a la ruta de `domain/`).
export type { ExtraCatalogoItem } from '../domain/catalogo-extras.port';

/** Dependencias del query (puerto inyectado). */
export interface ListarExtrasDeps {
  catalogo: CatalogoExtrasPort;
}

export class ListarExtrasUseCase {
  constructor(private readonly deps: ListarExtrasDeps) {}

  async ejecutar(tenantId: string): Promise<ExtraCatalogoItem[]> {
    return this.deps.catalogo.listarActivos(tenantId);
  }
}
