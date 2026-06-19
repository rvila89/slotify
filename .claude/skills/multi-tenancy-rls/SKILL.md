---
name: multi-tenancy-rls
description: Usar cuando se cree o modifique cualquier tabla, query o endpoint de negocio, para garantizar aislamiento por tenant y RLS.
---

# Multi-tenancy + RLS

## Cuándo usar
Al crear/modificar modelos Prisma de negocio, queries, repositorios o controladores que acceden a datos de un tenant.

## Reglas
- `tenant_id` en TODA tabla de negocio. RLS activo en PostgreSQL.
- En cada transacción/query se fija el tenant: `SET LOCAL app.tenant_id = ...`.
- `tenant_id` y `rol` viajan en el payload firmado del JWT.
- El `tenant_id` se deriva SIEMPRE del JWT, NUNCA del path ni del body.
- Obtenerlo con el decorador `@TenantId()`.
- Toda query filtra por `tenant_id`. Ninguna entidad cruza tenant.

## Patrón de referencia
```ts
@Get('reservas')
listar(@TenantId() tenantId: string) {
  return this.repo.listar(tenantId); // siempre filtrado por tenant
}

// en la transacción Prisma
await tx.$executeRaw`SET LOCAL app.tenant_id = ${tenantId}`;
```

## Errores comunes / Anti-patrones
- Leer `tenant_id` de `params`, `query` o `body`.
- Queries sin filtro `tenant_id` confiando solo en RLS, o sin `SET LOCAL`.
- Joins o lookups que devuelven filas de otro tenant.
- Pasar `tenant_id` como argumento manipulable desde el cliente.

## Fuentes
- CLAUDE.md
- docs/backend-standards.md
