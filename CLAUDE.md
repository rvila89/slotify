# AGENTS.md — Slotify

> Contexto para agentes de código. Complementa la documentación en `/docs/`.

---

## Arquitectura

- **Monorepo con dos apps**: `apps/web` (Vite + React SPA) y `apps/api` (NestJS).
- **Arquitectura hexagonal en backend**: `domain/` no importa de `infrastructure/` ni de frameworks. Los puertos (interfaces) viven en dominio; los adaptadores en infraestructura.
- **La reserva es el agregado raíz (DDD)**. Toda la lógica de estado, bloqueo de fecha y cola orbita alrededor de la entidad `Reserva`.

---

## Regla crítica: bloqueo atómico de fecha

El bloqueo de fecha **NO usa Redis ni locks distribuidos**. Usa:

1. Entidad `FECHA_BLOQUEADA` con restricción `UNIQUE(tenant_id, fecha)` en PostgreSQL.
2. Transacciones con `SELECT ... FOR UPDATE` vía Prisma `$queryRaw`.

Toda mutación de bloqueo pasa por `bloquearFecha()` y `liberarFecha()`. **No implementes bloqueo de otra forma.**

---

## Multi-tenancy

- `tenant_id` en toda tabla de negocio.
- Row-Level Security (RLS) activo.
- El `tenant_id` y `rol` viajan en el payload firmado del JWT.

---

## Stack y convenciones

| Capa | Tecnología |
|------|------------|
| Frontend | Vite + React + TypeScript + Tailwind + shadcn/ui |
| Backend | NestJS + TypeScript + Prisma ORM |
| BBDD | PostgreSQL (gestionada) |
| Auth | JWT (access en memoria + refresh en cookie httpOnly) |
| Email | Resend / Postmark |
| PDF | Puppeteer o react-pdf |

- Cliente HTTP del frontend generado desde el contrato OpenAPI del backend.
- Preferir functional patterns en TypeScript.

---

## Testing

- **TDD obligatorio para el núcleo crítico**: tests de concurrencia del bloqueo atómico de fecha antes que UI o CRUD.
- Tests de la máquina de estados de reservas (16+ transiciones).
- Ejecutar `pnpm test` antes de cualquier commit.

---

## Máquina de estados de reserva

Estados principales: `consulta` → `pre_reserva` → `reserva_confirmada` → `evento_en_curso` → `post_evento` → `reserva_completada`.

Sub-estados de consulta: `2a` (exploratoria), `2b` (con fecha), `2c` (pendiente invitados), `2d` (cola), `2v` (visita), `2x`/`2y`/`2z` (terminales).

Las transiciones permitidas y sus guardas se modelan como estructura de datos, no como código disperso.

---

## Jobs asíncronos

Patrón **estado en fila + barrido periódico**: campo `ttl_expiracion` + cron que invoca endpoint protegido. Es idempotente. No uses Lambda/EventBridge ni timers exactos.

---

## Documentación de referencia

- [architecture.md](docs/architecture.md) — Stack, decisiones, capas
- [er-diagram.md](docs/er-diagram.md) — Modelo de datos y decisiones de modelado
- [use-cases.md](docs/use-cases.md) — 36 casos de uso del MVP
- [c4-diagrams.md](docs/c4-diagrams.md) — Diagramas C4 (Context, Container, Component)

---

## Harness de agentes (SDD + TDD)

El desarrollo se hace con un harness de subagentes especializados. **No cargues `docs/` entero**: usa la skill `slotify-context` como router y deja que cada agente cargue solo su slice.

| Para… | Invoca el agente | Carga skills |
|-------|------------------|--------------|
| Coordinar una US de principio a fin | `harness-orchestrator` | `slotify-context`, `openspec-workflow` |
| Abrir/archivar un change OpenSpec | `spec-author` | `openspec-propose`, `openspec-archive`, `us-traceability` |
| Evolucionar/auditar el contrato OpenAPI, generar SDK | `contract-engineer` | `openapi-governance`, `contract-sync`, `sdk-codegen` |
| Escribir tests primero (RED) | `tdd-engineer` | `tdd-core`, `concurrency-locking`, `state-machine` |
| Implementar backend NestJS/Prisma | `backend-developer` | `hexagonal-ddd`, `atomic-date-lock`, `multi-tenancy-rls`, `async-jobs` |
| Implementar frontend (con Figma MCP) | `frontend-developer` | `figma-design-consume`, `frontend-feature`, `shadcn-tailwind`, `tanstack-forms` |
| Ejecutar QA (unit/curl/Playwright + reports) | `qa-verifier` | `qa-mandatory-steps`, `db-state-verify` |
| Revisar el diff contra guardrails | `code-reviewer` | `review-checklist`, `architecture-guardrails` |
| Sincronizar documentación | `docs-keeper` | `doc-sync` |

## Flujo de trabajo diario

`SDD → Contrato → TDD-RED → Implementación (back ∥ front) → QA → Review → Docs → Archive/PR`

- **Gates duros y secuenciales**: SDD → contrato → TDD-RED. No se implementa sin tests rojos.
- El contrato OpenAPI + SDK generado es la frontera que permite a back y front avanzar en paralelo.
- **El cliente HTTP del frontend se genera, nunca se edita a mano** (dueño: `contract-engineer`).
- La spec vive en `openspec/changes/<change>/`; el estado en `tasks.md` (`[ ]/[x]`) y `reports/`.

## Hooks que se aplican (no son sugerencias)

Configurados en `.claude/settings.json` (`scripts/hooks/`):
- **TDD**: bloquea implementar lógica crítica sin test hermano (`require-tests-first`).
- **Hexagonal**: bloquea imports de framework/infra en `domain/` (`no-infra-in-domain`).
- **Bloqueo atómico**: bloquea Redis/Redlock/locks distribuidos (`no-distributed-lock`).
- **Contrato**: bloquea editar el cliente generado a mano (`protect-generated-client`); valida `api-spec.yml` al editarlo (`validate-openapi`).

## Workflows / comandos

- `/analizar-backlog` + `/ordenar-backlog` — regeneran el grafo y el orden del backlog.
- `/audit-open-api` — auditoría puntual del contrato.
- "Implementa la siguiente US" → `harness-orchestrator`.
