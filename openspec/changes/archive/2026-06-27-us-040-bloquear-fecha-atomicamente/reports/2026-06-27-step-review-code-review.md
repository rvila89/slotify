# Code Review — us-040-bloquear-fecha-atomicamente

**Rama:** feature/us-040-bloquear-fecha-atomicamente (vs master)
**Fecha:** 2026-06-27
**Agente:** code-reviewer (solo lectura)
**Skills:** review-checklist, architecture-guardrails

> Alcance: infraestructura de dominio `bloquearFecha()` (UC-30), SIN endpoint HTTP (D-7).
> El diff está en working tree (untracked + `reservas.module.ts` modificado); no hay commits
> por delante de master todavía. Se revisó el contenido íntegro de los ficheros del change.

---

## Resumen de verificación de guardrails

| Guardrail | Estado |
|-----------|--------|
| Hexagonal: `domain/` sin `@nestjs/*`, `@prisma/*`, ni `infrastructure/` | OK |
| Bloqueo atómico SOLO con `UNIQUE(tenant_id,fecha)` + `SELECT … FOR UPDATE` | OK |
| Sin Redis / Redlock / lock distribuido / lock en memoria | OK |
| UNIQUE es la garantía final (no el SELECT); TOCTOU resuelto por el motor | OK |
| Mapa fase→(tipo,ttl,modo) como tabla declarativa, no `if/else` disperso | OK |
| Multi-tenancy: `tenant_id` filtra queries; RLS (`SET LOCAL`) activo; `TENANT_MISMATCH` | OK |
| Migración no destructiva (solo `ADD CONSTRAINT CHECK`) | OK |
| Errores de dominio en español | OK |
| Arrow functions (helpers/factories); métodos de clase exentos | OK |
| Idempotencia del upgrade firme por `reserva_id` | OK |
| Manejo de `P2002` → `FechaYaBloqueadaError` | OK (con matiz, ver M2) |
| Contrato OpenAPI sin tocar (D-7: no endpoint) | OK |
| TDD primero (concurrencia primero), batería verde 29/29 | OK |
| Importes en Decimal vs Float | N/A (no hay dinero en este change) |

---

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media

- **[M1] Riesgo de degradado firme→blando no guardado** —
  `infrastructure/fecha-bloqueada.prisma.adapter.ts:157-189` (`aplicarExtension`).
  Si la fila existente fuese `firme` (`ttl_expiracion = NULL`) y llega un `extend` (fase 2.c),
  `ttlBase = existente?.ttl_expiracion ?? new Date()` cae a `now()` y el UPDATE fija
  `tipoBloqueo: blando` + `ttl = now()+delta`, **degradando** silenciosamente un bloqueo firme.
  No es alcanzable por la máquina de estados válida (confirmada→2.c no existe), pero es un hueco
  de defensa en profundidad. Recomendación: si `existente.tipo_bloqueo === 'firme'`, rechazar
  el `extend` con error de dominio explícito en lugar de degradar.

- **[M2] Traducción de `P2002` demasiado amplia** —
  `infrastructure/fecha-bloqueada.prisma.adapter.ts:191-200` (`traducirError`).
  Cualquier `P2002` se convierte en `FechaYaBloqueadaError`. El esquema tiene `reservaId @unique`,
  así que un `insert`/`upgrade`/`extend` desde fila inexistente de una reserva que ya bloquea OTRA
  fecha dispararía `P2002` sobre `reserva_id` y se reportaría, engañosamente, como "fecha ya
  bloqueada por otra reserva". Recomendación: discriminar por `error.meta.target` y emitir un
  error distinto (p. ej. `RESERVA_YA_TIENE_BLOQUEO`) cuando la colisión sea de `reserva_id`.

- **[M3] `SET LOCAL` con `$executeRawUnsafe` + escape manual de comillas** —
  `infrastructure/fecha-bloqueada.prisma.adapter.ts:74-81` (y replicado en
  `shared/prisma/prisma.service.ts`). `SET LOCAL app.tenant_id = '<interpolado>'` usa
  `$executeRawUnsafe` con `replace(/'/g, "''")`. El `tenantId` es un UUID de contexto, está
  escapado y el patrón es coherente con el helper compartido preexistente, por lo que el riesgo
  efectivo es bajo; aun así, lo robusto es parametrizar con `SELECT set_config('app.tenant_id', $1, true)`
  vía `$executeRaw`. Recomendación de hardening, no bloqueante.

### Baja

- **[B1] DRY — `fijarTenant` duplicado** —
  `fecha-bloqueada.prisma.adapter.ts:74-81` reimplementa `PrismaService.fijarTenant` en vez de
  reutilizarlo. La causa es el tipado del constructor (`Pick<PrismaClient,'$transaction'>`), que no
  expone el helper. El adaptador de `tenant-settings` sí reutiliza `this.prisma.fijarTenant`. Unificar.

- **[B2] Fallback insert-desde-null en `extend`/`upgrade`** —
  `aplicarUpgrade`/`aplicarExtension` crean fila cuando `existente === null`. El mapa declarativo
  asume fila existente para esos modos; el fallback es defensivo y benigno, pero conviene
  documentarlo (o que el dominio garantice la precondición).

- **[B3] Normalización de fecha en frontera** —
  El SELECT usa `toISOString().slice(0,10)::date` mientras el INSERT pasa el objeto `Date`
  (`@db.Date`). Es consistente para fechas a medianoche UTC (los callers actuales), pero un `Date`
  con componente horario/offset local podría desalinear SELECT vs INSERT. Recomendación: normalizar
  la `fecha` a fecha-UTC en el borde de entrada.

- **[B4] Estado de `tasks.md`** (informativo): pasos 1.x (gate SDD), 9.x (docs), 10.x (este review)
  y 11.x (gate final) siguen sin marcar — esperado en este punto del flujo.

---

## OK (verificado)

- **Hexagonal**: `domain/bloquear-fecha.service.ts` es dominio puro — no importa `@nestjs/*`,
  `@prisma/*` ni `infrastructure/`. Puertos (`FechaBloqueadaRepositoryPort`, `TenantSettingsPort`,
  `ClockPort`) definidos en dominio; adaptadores en infra; wiring por token (Symbol) en el módulo.
  `depcruise` sin violaciones (75 módulos).
- **Bloqueo atómico correcto**: la exclusión mutua vive solo en PostgreSQL. `SELECT … FOR UPDATE`
  vía `$queryRaw` serializa la fila objetivo; cuando la fila no existe, dos INSERT compiten y el
  `UNIQUE(tenant_id, fecha)` decide (1 éxito + 1 `P2002`). El comentario del adaptador y el design
  (D-1) lo explican correctamente: **el UNIQUE es la última línea, no el SELECT**. Verificado por
  el test de concurrencia (`Promise.allSettled` → 1 fulfilled + 1 FechaYaBloqueadaError, 1 fila final).
- **Sin lock distribuido**: grep de `redis|redlock|ioredis|mutex|lock(` en `reservas/` solo aparece
  en comentarios que lo prohíben.
- **Mapa declarativo**: `resolverPlanBloqueo` es una tabla (switch que devuelve datos), función pura
  inyectando `ahora`/`settings`; sin lógica dispersa por caller.
- **Multi-tenancy/RLS**: ambos adaptadores fijan `SET LOCAL app.tenant_id` dentro de `$transaction`
  antes de tocar datos; las queries filtran `tenant_id`; el dominio valida `TENANT_MISMATCH`
  (bloqueo vs reserva). Sin endpoint (D-7), el `tenant_id` lo aporta el flujo invocante desde el
  contexto/JWT — coherente.
- **Migración no destructiva**: solo añade `chk_firme_sin_ttl` y `chk_blando_con_ttl`; `UNIQUE` y RLS
  preexisten desde US-000. Predicado temporal `ttl>now()` correctamente excluido del CHECK y validado
  en dominio.
- **Idempotencia**: upgrade firme con mismo `reserva_id` → UPDATE sin error (test verde); con
  `reserva_id` distinto → `FechaYaBloqueadaError`.
- **Errores en español**: `ValidacionBloqueoError`, `FechaEnPasadoError`, `TenantMismatchError`,
  `FechaYaBloqueadaError`, todos con mensaje en español y payload de diagnóstico.
- **Arrow functions**: helpers (`sumarDias`, `inicioDiaUtc`, `resolverPlanBloqueo`) y factories del
  módulo son flechas; los métodos de clase quedan exentos. Sin `function` declarativo.
- **TDD primero**: tests RED documentados (concurrencia primero), 29/29 verde, suite 71/71 verde,
  `depcruise` limpio (report step N+1).
- **Contrato**: D-7 justifica no exponer endpoint; `docs/api-spec.yml` no se toca; cliente del
  frontend no editado.

---

## Veredicto: APTO

No hay hallazgos Bloqueantes ni de severidad Alta. Las recomendaciones M1–M3 (defensa en
profundidad / hardening) y B1–B4 son mejoras no bloqueantes que pueden abordarse en este change
o en uno de seguimiento sin frenar el merge.
