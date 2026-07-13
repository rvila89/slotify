/**
 * Puerto de LECTURA del catálogo de EXTRAS del tenant (US-014, `GET /extras`).
 *
 * Se mantiene separado de `ExtraRepositoryPort` (que el motor de tarifa usa solo
 * para resolver un extra por id al calcular subtotales): listar el catálogo es
 * una responsabilidad distinta (alimenta el selector del borrador de presupuesto)
 * y no debe acoplarse al puerto del motor (ISP). El aislamiento multi-tenant
 * (RLS / filtrado por `tenant_id`, solo `activo=true`) lo aplica el adaptador.
 */

/** Item del catálogo de extras del tenant (read-model). `precioEur` en euros. */
export interface ExtraCatalogoItem {
  idExtra: string;
  nombre: string;
  descripcion: string | null;
  precioEur: number;
  activo: boolean;
}

/** Lee los EXTRAS activos del catálogo del tenant (RLS: solo su tenant). */
export interface CatalogoExtrasPort {
  listarActivos(tenantId: string): Promise<ExtraCatalogoItem[]>;
}
