# Tasks — us-000-setup-scaffolding

Trazabilidad: **US-000** (Technical Foundation Story; habilita UC-01..UC-36).
Pasos obligatorios según `openspec/config.yaml`. Marcar `[x]` SOLO tras ejecutar y verificar.
El agente ejecuta las pruebas; nunca se delegan al usuario.

## Step 0 — Crear feature branch (OBLIGATORIO, PRIMERO)

- [x] 0.1 Crear y cambiar a `feature/us-000-setup-scaffolding` (ya hecho).

## Fase 1 — Esqueleto del monorepo

- [x] 1.1 `package.json` raíz (pnpm workspace) con scripts `dev/build/test/test:e2e/lint/typecheck/db:migrate/db:seed/generate-client`.
- [x] 1.2 `pnpm-workspace.yaml` (`apps/*`) y `turbo.json` (pipelines paralelos con caché).
- [x] 1.3 `.gitignore`, `.env.example` (todas las variables del §Variables de entorno, sin valores reales).
- [x] 1.4 `docker-compose.yml` con PostgreSQL 15.
- [x] 1.5 `pnpm install` desde la raíz: workspace reconoce `apps/api` (`apps/web` pendiente de Fase 4).

## Fase 2 — Capa de datos (PRIORIDAD)

- [x] 2.1 `apps/api/prisma/schema.prisma`: 17 entidades del `er-diagram.md`, todas con PK UUID (Regla 1).
- [x] 2.2 Enums `EstadoReserva`, `SubEstadoConsulta`, `TipoBloqueo`.
- [x] 2.3 `@@unique([tenantId, fecha])` en `FechaBloqueada`; demás UNIQUE e índices críticos; `tenantId` en toda tabla de negocio (Regla 2).
- [x] 2.4 Migración inicial con RLS (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` con `current_setting('app.tenant_id')`) e índice full-text GIN vía SQL crudo.
- [x] 2.5 `apps/api/prisma/seed.ts`: tenant Masia l'Encís, settings (40/500/3/7/7), gestor argon2, 12 temporadas, 45 tarifas (`vigente_desde=2026-01-01`), 2 extras.

## TDD primero (RED) — antes de cualquier implementación de lógica

- [x] T.1 Test de concurrencia `apps/api/src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts`: dos tx concurrentes misma `(tenant,fecha)` → 1 éxito / 1 `P2002`. Debe correr en `test:e2e` y estar en ROJO antes de implementar.
- [x] T.2 Smoke test por módulo y test de arranque (health/401) en estado RED inicial.

## Fase 3 — Esqueleto NestJS arrancable

- [x] 3.1 `main.ts`: Swagger `/api/docs` (+ JSON `/api/docs-json`), CORS (`WEB_URL`), `ValidationPipe` global, `HttpExceptionFilter` global, prefijo `/api`.
- [x] 3.2 `ConfigModule` con validación **zod** (falla si falta variable o `JWT_ACCESS_SECRET` vacío/< 32 chars), con mensaje explícito.
- [x] 3.3 `GET /api/health` → `{ status: "ok" }`; `JwtAuthGuard` global (401 sin token) + `@Public()`; `RolesGuard`; decoradores `@CurrentUser`/`@TenantId`; `PrismaService` con `SET LOCAL app.tenant_id`.
- [x] 3.4 Carpetas módulos hexagonales: auth/reservas/calendario/clientes/presupuestos/facturacion/comunicaciones/ficha-evento/tareas/dashboards/configuracion + `shared/`, cada uno con smoke test.

## Fase 4 — Esqueleto frontend Vite+React

- [x] 4.1 `apps/web`: Vite + React + Tailwind + shadcn; ruta `/login` con formulario; sin `localStorage`/`sessionStorage` (Regla 3).
- [x] 4.2 Smoke test Vitest del frontend.

## Fase 5 — Contrato / codegen

- [x] 5.1 Script `generate-client` (openapi-typescript + openapi-fetch) → `apps/web/src/api-client/` (`schema.d.ts` + `client.ts` + `index.ts`; cliente generado, no editado a mano). Genera desde el estático `docs/api-spec.yml` (reproducible). Verificado: typecheck 0 errores, build OK, spectral 0 errores.

## Fase 6 — Gate de calidad / arquitectura

- [x] 6.1 Test de arquitectura hexagonal (dependency-cruiser): bloquea imports de `infrastructure/prisma/@nestjs` en `*/domain/**` (Regla 6). Config `apps/api/.dependency-cruiser.cjs`, script `arch`, integrado en `test` y task turbo `arch`. Verificado: baseline limpio (55 módulos), violaciones nestjs/prisma/zod/infrastructure detectadas con exit 1.
- [x] 6.2 `pnpm lint && pnpm typecheck && pnpm test` → exit 0 (Regla 5). ESLint flat config añadido en `apps/api/eslint.config.mjs`. Verificado los 4 gates en exit 0 (lint, typecheck, test —jest 19/19 + vitest 1/1—, arch).

## Step N — Revisar y actualizar tests unitarios

- [x] N.1 Revisar/actualizar los tests unitarios (smoke por módulo, config zod, guard 401) tras la implementación.

## Step N+1 — Ejecutar unit tests + verificar estado BD + report (AGENTE DEBE EJECUTAR)

- [x] N+1.1 Ejecutar `pnpm test` (Jest api + Vitest web), `pnpm db:migrate` y `pnpm db:seed`; verificar estado BD (45 tarifas, 12 temporadas, 2 extras, tenant + gestor).
- [x] N+1.2 Report en `reports/2026-06-19-step-N+1-unit-test-and-db-verification.md`.

## Step N+2 — Pruebas manuales con curl (AGENTE DEBE EJECUTAR; restaurar BD)

- [x] N+2.1 `curl` a `GET /api/health` (200 `{status:"ok"}`), `GET /api/docs`, y endpoint protegido sin token (401). Restaurar BD tras pruebas.
- [x] N+2.2 Report en `reports/2026-06-19-step-N+2-curl-endpoint-tests.md`.

## Step N+3 — E2E con Playwright MCP (frontend presente; AGENTE DEBE EJECUTAR)

- [x] N+3.1 E2E: cargar SPA, navegar a `/login`, verificar render del formulario y Tailwind activo.
- [x] N+3.2 Report en `reports/2026-06-19-step-N+3-e2e-playwright.md`.

## Step N+4 — Actualizar documentación técnica

- [x] N+4.1 Actualizar `docs/` (README de arranque, comandos del monorepo) coherente con el scaffolding.

## Cierre

- [x] C.1 `openspec validate us-000-setup-scaffolding --strict` OK.
- [ ] C.2 `openspec archive us-000-setup-scaffolding`; actualizar `openspec/specs/`; abrir PR.
