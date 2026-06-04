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
