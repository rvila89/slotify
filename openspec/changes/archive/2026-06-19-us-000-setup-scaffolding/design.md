# Design — us-000-setup-scaffolding

## Context

US-000 es la Technical Foundation Story. No hay UC funcional; las decisiones se anclan
en `architecture.md` y `er-diagram.md`. El objetivo es que cualquier miembro del equipo
ejecute `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm typecheck && pnpm test`
en un entorno limpio y obtenga exit 0 en < 5 min, con la garantía atómica de
no-doble-reserva activa desde la migración 0.

## Decisiones técnicas

### D-1. Validador de entorno = zod
La US permite Joi **o** zod. Se elige **zod** por coherencia con el ecosistema
TypeScript del monorepo y por inferencia de tipos del config. La validación corre en
`ConfigModule` antes de inicializar el dominio; falla el bootstrap si falta una variable
o si `JWT_ACCESS_SECRET` < 32 chars.

### D-2. Codegen SDK = openapi-typescript
Frente a `openapi-typescript-codegen`, se usa **openapi-typescript** para emitir tipos +
cliente fetch tipado en `apps/web/src/api-client/`. El cliente es generado, nunca editado
a mano (hook `protect-generated-client`).

### D-3. Turborepo = sí
`turbo.json` orquesta `dev/build/test/lint/typecheck` en paralelo con caché. Los scripts
raíz delegan en `turbo`.

### D-4. RLS e índice GIN vía SQL crudo en la migración
Prisma no modela RLS ni índices full-text GIN. Se añaden con SQL crudo dentro de la
migración inicial: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` con
`current_setting('app.tenant_id')`, y `CREATE INDEX ... USING GIN (...)`. La verificación
funcional de RLS se difiere a las US de cada módulo (datos multi-tenant reales).

### D-5. Bloqueo atómico = constraint de BD, no lógica aplicativa
`@@unique([tenantId, fecha])` en `FechaBloqueada`. Prohibido Redis/Redlock/locks
distribuidos (hook `no-distributed-lock`). El test de concurrencia es el primer test (RED).

### D-6. PKs UUID en todos los modelos
`String @id @default(uuid())`. Ningún `Int autoincrement` (Regla 1).

## Riesgos / Trade-offs

- **Postgres 15 en Docker**: el `docker-compose.yml` fija la versión para reproducibilidad;
  los tests de concurrencia/E2E necesitan una BD aislada.
- **Esqueletos vacíos**: cada módulo hexagonal lleva un smoke test mínimo para que
  `pnpm test` tenga al menos un test por módulo y no quede en 0 tests.

## Pendiente / fuera de alcance
- CI/CD de producción (Railway/Render).
- Verificación funcional end-to-end de RLS multi-tenant (US por módulo).
