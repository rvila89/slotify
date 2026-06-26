# Change: us-000-setup-scaffolding

## Why

Ninguna historia de usuario funcional (UC-01 a UC-36) puede iniciarse sin una base
estructural: monorepo, esquema de datos, seed del tenant piloto y esqueletos
arrancables de backend y frontend. Esta es una **Technical Foundation Story**
(US-000) anclada en `architecture.md §2` y `er-diagram.md`, no en un UC funcional.

Resuelve dos dolores normativos:
- **D1** — single source of truth técnico (schema Prisma + tipos OpenAPI + seed)
  elimina la desincronización entre capas. (`US-000 §Contexto`)
- **D4** — el constraint `UNIQUE(tenant_id, fecha)` sobre `FECHA_BLOQUEADA` se
  provisiona desde la primera migración; la garantía de no-doble-reserva está
  activa desde el día 0. (`architecture.md §2.4`, `er-diagram.md §3.6`)

## What Changes

- **Esqueleto monorepo**: `package.json` raíz (pnpm workspace), `pnpm-workspace.yaml`,
  `turbo.json`, `.gitignore`, `.env.example`, `docker-compose.yml` (Postgres 15), y los
  scripts `dev/build/test/test:e2e/lint/typecheck/db:migrate/db:seed/generate-client`.
  (`US-000 §Scripts de raíz`)
- **Capa de datos (PRIORIDAD)** en `apps/api/prisma/`: `schema.prisma` con las 17
  entidades del `er-diagram.md`, enums (`EstadoReserva`, `SubEstadoConsulta`,
  `TipoBloqueo`), `@@unique([tenantId, fecha])` en `FechaBloqueada`, demás UNIQUE e
  índices críticos; primera migración con RLS (`ENABLE ROW LEVEL SECURITY` +
  `CREATE POLICY` usando `current_setting('app.tenant_id')`) e índice full-text GIN vía
  SQL crudo; `seed.ts` del tenant piloto **Masia l'Encís**. (`US-000 §Esquema Prisma`, `§Seed`)
- **TDD-RED**: test de concurrencia del bloqueo atómico en
  `apps/api/src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts`. (`US-000 §Concurrencia`)
- **Esqueleto NestJS arrancable**: `main.ts` (Swagger `/api/docs`, CORS, `ValidationPipe`,
  `HttpExceptionFilter`), `ConfigModule` con validación **zod**, `GET /api/health`,
  `JwtAuthGuard` (401 sin token) y carpetas de módulos hexagonales. (`US-000 §Backend arranca`)
- **Esqueleto frontend** Vite+React: `/login` con shadcn, sin `localStorage`, smoke test
  Vitest. (`US-000 §Frontend arranca`)
- **Contrato/codegen**: script `generate-client` (openapi-typescript) →
  `apps/web/src/api-client/`. (`US-000 §Scripts`, nota de alcance)
- **Gate de calidad**: test de arquitectura hexagonal (dependency-cruiser);
  `pnpm lint && pnpm typecheck && pnpm test` con exit 0. (`US-000 §Reglas 5 y 6`)

## Impact

- Specs afectadas: nueva capability **`foundation`** (infraestructura / fundación de datos).
- Código afectado (implementación posterior, fuera de este change de spec):
  `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `docker-compose.yml`,
  `apps/api/**`, `apps/web/**`, `.env.example`.
- Trazabilidad: **US-000**; sin UC funcional (habilita UC-01..UC-36).
- Fuera de alcance: despliegue Railway/Render (CI/CD de producción), verificación
  funcional de RLS multi-tenant (se valida en las US de cada módulo).
