# Harness Engineering Plan — Slotify
> SDD + TDD con Claude Code · Versión 1.0

---

## Contexto

Slotify es un SaaS multi-tenant (gestión de espacios de eventos) en fase **docs-only**: existe documentación completa (`docs/`), 48 user stories (`user-stories/`), contrato OpenAPI (`docs/api-spec.yml`) y tooling determinista de backlog (`scripts/extract_backlog.py`), pero no hay código (`apps/web` / `apps/api` no existen aún).

El harness actual está roto: los 5 agentes en `.claude/agents/` son ficheros de 0 bytes (symlinks muertos a un `ai-specs/` inexistente), las skills fueron borradas, y solo sobreviven 3 commands (`/analizar-backlog`, `/ordenar-backlog`, `/audit-open-api`). No hay `settings.json`, ni hooks, ni MCP config, ni CI.

**Objetivo:** construir un harness de Claude Code de nivel producción que desarrolle Slotify con metodología **SDD (OpenSpec CLI) → TDD → Implementación → QA → Documentación**, con contratos OpenAPI como fuente de verdad, alta automatización y bajo consumo de contexto.

**Decisiones confirmadas:**

1. SDD engine = OpenSpec CLI — se reinstala `openspec/`, `config.yaml` y las skills `propose→apply→archive→sync`.
2. Materializar harness completo — todos los ficheros: agentes, skills, hooks, settings, CLAUDE.md, codegen.
3. Codegen SDK = decisión diferida — el agente `contract-engineer` recomienda `orval` vs `openapi-typescript` durante US-000.

**Por qué mejora frente al actual:** pasamos de stubs vacíos sin gobierno a un sistema de agentes especializados con responsabilidades disjuntas, hooks que hacen cumplir (no solo sugerir) TDD/contrato/arquitectura, y un flujo SDD reproducible. El contexto se mantiene bajo porque cada agente carga solo su slice de docs vía skills, no el repo entero.

---

## 1. Arquitectura del harness (capas)

```
┌─ CLAUDE.md (router) ─ contexto mínimo + índice de cuándo invocar qué
│
├─ OpenSpec CLI (SDD) ─ openspec/ = fuente de verdad de specs y cambios
│     specs/<capability>/ · changes/<change>/{proposal,tasks,design,reports}
│
├─ Agentes (.claude/agents) ─ ejecutores especializados, contexto aislado
│     orquestador → spec → contrato → tests → backend/frontend → QA → docs
│
├─ Skills (.claude/skills) ─ conocimiento reutilizable, bajo coste de contexto
│     cargadas on-demand por los agentes (no precargadas)
│
├─ Hooks (.claude/settings.json) ─ enforcement determinista (no-bypass)
│     PreToolUse · PostToolUse · Stop · SubagentStop
│
└─ MCP ─ Figma (diseño), Playwright (E2E), GitHub, Context7 (docs libs)
```

> **Principio rector:** El agente principal orquesta; los subagentes ejecutan en contexto aislado y devuelven solo conclusiones. Esto mantiene bajo el consumo de contexto del hilo principal (los volcados de ficheros viven y mueren en el subagente).

---

## 2. Mapa de agentes recomendado

### Conservar (reconstruir desde 0 bytes → completos)

| Agente | Decisión | Motivo |
|---|---|---|
| `backend-developer` | Conservar + reescribir | Núcleo NestJS/Prisma/hexagonal imprescindible |
| `frontend-developer` | Conservar + reescribir + Figma MCP | Núcleo React/Tailwind; ahora consume diseños de Figma |
| `code-reviewer` (era `Code-reviewer`) | Conservar + renombrar | Revisión de PR; normalizar nombre a kebab-case |

### Eliminar / fusionar

| Agente | Decisión | Motivo |
|---|---|---|
| `Openapi-advisor` | Fusionar → `contract-engineer` | "Advisor" es pasivo; lo elevamos a dueño activo del contrato (audita, evoluciona, valida, genera SDK, sincroniza back/front). Absorbe la lógica de `/audit-open-api` |
| `product-strategy-analyst` | Fusionar → `spec-author` | Estrategia de producto sin código aporta poco al harness técnico; su valor (backlog, US, trazabilidad) se reorienta a autor de specs OpenSpec |

### Agentes nuevos

| Agente | Responsabilidad |
|---|---|
| `harness-orchestrator` | Punto de entrada. Lee `_backlog.json`, selecciona la siguiente US, orquesta el ciclo SDD→TDD→impl→QA→docs delegando a subagentes. No escribe código de negocio |
| `spec-author` | Traduce US + docs a un change de OpenSpec (`proposal.md`, `tasks.md`, spec-deltas). Garantiza Step 0 (branch) y los pasos obligatorios de `openspec-tasks-mandatory-steps.md` |
| `contract-engineer` | Dueño del contrato OpenAPI. Gobierno, evolución, validación, generación de SDK y sincronización backend↔frontend. Recomienda generador codegen en US-000 |
| `tdd-engineer` | Escribe tests primero (concurrencia del bloqueo atómico, máquina de estados, tarifas). Verifica que fallan antes de implementar (RED) |
| `qa-verifier` | Ejecuta los pasos obligatorios agent-must-execute: unit + curl + Playwright E2E + reports en `changes/<change>/reports/`. Nunca delega al usuario |
| `docs-keeper` | Sincroniza `docs/` (data-model, er-diagram, api-spec, standards) tras cada cambio, según `documentation-standards.md` |

> **Roster final (9 agentes):** `harness-orchestrator`, `spec-author`, `contract-engineer`, `tdd-engineer`, `backend-developer`, `frontend-developer`, `qa-verifier`, `code-reviewer`, `docs-keeper`.

---

## 3. Responsabilidades, herramientas y permisos por agente

> Cada agente declara tools mínimas (principio de menor privilegio) y carga su contexto vía skills, no precargado.

| Agente | Model | Tools / MCP | Permisos clave | Skills |
|---|---|---|---|---|
| `harness-orchestrator` | opus | `Task`, `Read`, `Bash(openspec*, git status)`, `TodoWrite` | Solo orquesta; no edita código de negocio | `slotify-context`, `openspec-workflow` |
| `spec-author` | opus | `Read`, `Write(openspec/**)`, `Bash(openspec*)`, `Edit` | Escribe solo bajo `openspec/`; crea branch | `openspec-propose`, `slotify-domain`, `us-traceability` |
| `contract-engineer` | opus | `Read`, `Edit(api-spec.yml, apps/api/**/dto, generated client)`, `Bash(redocly/spectral, codegen)`, `Write(docs/audits)` | Dueño de `api-spec.yml`; ejecuta validación + codegen | `openapi-governance`, `contract-sync`, `sdk-codegen` |
| `tdd-engineer` | opus | `Read`, `Write(**/*.spec.ts, **/*.test.ts)`, `Bash(pnpm test)` | Solo escribe tests; no código de producción | `tdd-core`, `concurrency-locking`, `state-machine` |
| `backend-developer` | opus | `Read`, `Edit/Write(apps/api/**)`, `Bash(pnpm, prisma, nest)` | No toca `domain/` con imports de infra (hook lo bloquea) | `hexagonal-ddd`, `multi-tenancy-rls`, `atomic-date-lock`, `async-jobs` |
| `frontend-developer` | opus | `Read`, `Edit/Write(apps/web/**)`, `Bash(pnpm)`, Figma MCP (`get_design_context`, `get_screenshot`, `get_metadata`, `get_code_connect_map`, `get_variable_defs`) | Consume cliente generado, no inventa tipos API | `frontend-feature`, `figma-design-consume`, `shadcn-tailwind`, `tanstack-forms` |
| `qa-verifier` | sonnet | `Read`, `Bash(pnpm test/e2e, curl, server up)`, Playwright MCP, `Write(reports)` | Ejecuta TODOS los tests; restaura BD; crea reports | `qa-mandatory-steps`, `db-state-verify` |
| `code-reviewer` | opus | `Read`, `Bash(git diff, pnpm lint)`, `Grep` | Solo lectura + informe; no auto-fix | `review-checklist`, `architecture-guardrails` |
| `docs-keeper` | sonnet | `Read`, `Edit(docs/**)`, `Bash(git diff)` | Solo `docs/`; consistencia cruzada | `doc-sync`, `slotify-domain` |

**MCP servers configurados:** Figma (frontend), Playwright (qa-verifier E2E), GitHub (PR/issues), Context7 (docs de NestJS/Prisma/TanStack on-demand).

---

## 4. Flujo completo SDD → TDD → Implementación → QA → Documentación

```
[0] harness-orchestrator
      lee user-stories/_backlog.json → siguiente US (orden por deps/criticidad)
        │
[1] SDD ── spec-author
      openspec change <us>  →  proposal.md + spec-delta + tasks.md (con Step 0 branch
      y pasos obligatorios)  →  `openspec validate --strict`
        │
[2] CONTRATO ── contract-engineer  (si la US toca API)
      evoluciona api-spec.yml  →  spectral/redocly lint  →  regenera SDK
      →  sincroniza DTOs backend ↔ cliente frontend
        │
[3] TDD-RED ── tdd-engineer
      escribe specs (concurrencia lock, transiciones, tarifas)  →  `pnpm test`
      DEBE fallar (hook verifica que hay tests nuevos antes de permitir impl)
        │
[4] IMPL-GREEN ── backend-developer ∥ frontend-developer  (paralelo si independientes)
      implementan hasta que los tests pasan; hexagonal + multi-tenant + Figma
        │
[5] QA ── qa-verifier
      unit + curl (con restauración BD) + Playwright E2E  →  reports/
      Steps N+1..N+3 obligatorios, agent-must-execute
        │
[6] REVIEW ── code-reviewer
      diff vs guardrails arquitectónicos + checklist  →  informe (no merge si falla)
        │
[7] DOCS ── docs-keeper
      sincroniza data-model/er-diagram/api-spec/standards  →  consistencia cruzada
        │
[8] ARCHIVE ── spec-author
      `openspec archive <change>`  →  actualiza specs/  →  PR (GitHub MCP)
```

> **Gate entre fases:** cada transición tiene un hook o validación que bloquea avanzar si la fase previa no cumplió (ver §7).

---

## 5. Organización `.claude/agents`

```
.claude/agents/
  harness-orchestrator.md      # opus · orquestación
  spec-author.md               # opus · SDD/OpenSpec
  contract-engineer.md         # opus · OpenAPI governance + sync + codegen
  tdd-engineer.md              # opus · tests-first
  backend-developer.md         # opus · NestJS/Prisma/hexagonal
  frontend-developer.md        # opus · React/Tailwind + Figma MCP
  qa-verifier.md               # sonnet · curl/Playwright/reports
  code-reviewer.md             # opus · review (renombrado de Code-reviewer)
  docs-keeper.md               # sonnet · docs sync
```

> Eliminar: `Openapi-advisor.md`, `product-strategy-analyst.md`, `Code-reviewer.md` (mayúsculas).
> Cada `.md` con frontmatter: `name`, `description` (con triggers "use when…"), `tools`, `model`, y cuerpo conciso que delega el detalle a skills.

---

## 6. Organización `.claude/skills`

```
.claude/skills/
  # Contexto de dominio (compartidas)
  slotify-context/SKILL.md          # router de docs, qué leer para qué
  slotify-domain/SKILL.md           # entidades, ubiquitous language ES

  # SDD / OpenSpec
  openspec-workflow/SKILL.md        # ciclo propose→apply→archive→sync
  openspec-propose/SKILL.md
  openspec-apply/SKILL.md
  openspec-archive/SKILL.md
  openspec-sync-specs/SKILL.md
  us-traceability/SKILL.md          # US ↔ paths ↔ ER (absorbe extract_backlog)

  # Arquitectura backend
  hexagonal-ddd/SKILL.md
  atomic-date-lock/SKILL.md         # UNIQUE + SELECT FOR UPDATE (regla crítica)
  state-machine/SKILL.md            # transiciones como tabla declarativa
  multi-tenancy-rls/SKILL.md
  async-jobs/SKILL.md               # estado en fila + barrido idempotente

  # Contrato
  openapi-governance/SKILL.md       # absorbe /audit-open-api
  contract-sync/SKILL.md            # back DTO ↔ front client
  sdk-codegen/SKILL.md              # orval vs openapi-typescript (decisión US-000)

  # Testing / QA
  tdd-core/SKILL.md                 # RED-GREEN-REFACTOR, orden de prioridad
  concurrency-locking/SKILL.md      # tests de concurrencia del lock
  qa-mandatory-steps/SKILL.md       # curl + Playwright + reports
  db-state-verify/SKILL.md

  # Frontend
  figma-design-consume/SKILL.md     # flujo get_design_context→implement
  shadcn-tailwind/SKILL.md
  tanstack-forms/SKILL.md

  # Transversal
  review-checklist/SKILL.md
  architecture-guardrails/SKILL.md
  doc-sync/SKILL.md
```

> Commands existentes (`/analizar-backlog`, `/ordenar-backlog`) se conservan. `/audit-open-api` se migra a la skill `openapi-governance` usada por `contract-engineer` (manteniendo el command como atajo).

---

## 7. Hooks recomendados (`.claude/settings.json` + `scripts/hooks/`)

> Los hooks son determinismo no-bypasseable — donde el prompt "sugiere", el hook bloquea.

### TDD enforcement

- **`PreToolUse(Edit|Write)`** sobre `apps/api/**/*.ts` o `apps/web/**/*.tsx` (no-test):
  `scripts/hooks/require-tests-first.sh` → si no existe un `*.spec.ts` correspondiente más nuevo que el último test run, `deny` con mensaje `"TDD: escribe el test primero (tdd-engineer)"`.
- **`Stop`**: `pnpm test` rápido sobre módulos tocados; si falla, recordatorio de no cerrar en RED sin justificación.

### Contrato OpenAPI

- **`PostToolUse(Edit)`** sobre `docs/api-spec.yml`:
  `scripts/hooks/validate-openapi.sh` → spectral lint + redocly lint; si rompe, mensaje de error. Marca flag `"SDK desincronizado"`.
- **`PreToolUse(Edit)`** sobre cliente generado (`apps/web/src/api-client/**`): `deny` edición manual → `"regenera con contract-engineer, no edites a mano"`.
- **`PostToolUse`** sobre DTOs backend: recuerda regenerar/validar contrato.

### Guardrails arquitectónicos

- **`PreToolUse(Edit|Write)`** sobre `apps/api/**/domain/**`:
  `scripts/hooks/no-infra-in-domain.sh` → grep de imports prohibidos (`@nestjs/*`, `@prisma/*`, `infrastructure/`); si los hay, `deny` `"domain no importa framework/infra (hexagonal)"`.
- **`PreToolUse(Edit)`** que introduzca bloqueo de fecha fuera de `bloquearFecha()`/`liberarFecha()` o que añada Redis/lock distribuido → `deny` `"el bloqueo es UNIQUE + SELECT FOR UPDATE; no otra forma"`.
- **`PreToolUse`**: query Prisma sin filtro `tenant_id` / sin `SET LOCAL app.tenant_id` → warning de multi-tenancy.

### Calidad / commits

- **`PreToolUse(Bash git commit)`**: `pnpm lint && pnpm test` deben pasar (gate de US-000).
- **`SubagentStop`**: valida que `qa-verifier` produjo el report en `changes/<change>/reports/` antes de marcar tarea completa.

---

## 8. Estrategia de paralelización

- **Secuencial obligatorio:** SDD → contrato → TDD-RED (gates duros; cada uno alimenta al siguiente).
- **Paralelo seguro** (un solo mensaje, varios `Task`):
  - `backend-developer` ∥ `frontend-developer` cuando la US tiene capas independientes y el contrato ya está congelado (el SDK generado es la frontera que evita conflictos).
  - `code-reviewer` ∥ `docs-keeper` en fase final (lectura + docs, no colisionan).
  - Exploración inicial: hasta 3 `Explore` en paralelo.
- **Aislamiento por worktree** (`isolation: worktree`) cuando dos agentes mutan ficheros simultáneamente para evitar colisiones.

> **Regla de frontera:** el contrato OpenAPI + SDK generado es el contract boundary que permite a back y front avanzar en paralelo sin pisarse — por eso el contrato se congela antes de implementar.

---

## 9. Estrategia de context engineering (bajo consumo)

1. **CLAUDE.md como router, no enciclopedia:** mantiene reglas críticas + tabla "para X, invoca agente Y / lee skill Z". No vuelca docs.
2. **Skills cargadas on-demand:** el detalle de hexagonal, lock atómico, Figma, etc. vive en skills que el agente carga solo cuando las necesita — no en el system prompt.
3. **Subagentes como sumideros de contexto:** la exploración/lectura masiva ocurre en subagentes que devuelven solo conclusiones al hilo principal.
4. **`slotify-context` skill = índice de docs:** mapea "qué documento responde qué pregunta" para que los agentes lean el slice mínimo (p.ej. solo `er-diagram.md §X`), no `docs/` entero.
5. **OpenSpec changes acotan el scope:** cada change carga solo su `proposal/tasks/spec-delta`, no todo el backlog.
6. **Context7 MCP** para docs de librerías (NestJS/Prisma/TanStack) en vez de adivinar de memoria — bajo coste, alta precisión.

---

## 10. Memoria y transferencia de contexto entre agentes

**Artefactos en disco como memoria compartida** (no contexto conversacional):

- `user-stories/_backlog.json` → orquestador sabe qué sigue.
- `openspec/changes/<change>/` → `proposal.md`, `tasks.md` (estado `[ ]`/`[x]`), `design.md`, `reports/` son el handoff entre `spec-author` → `tdd` → `dev` → `qa`.
- `docs/audits/openapi-verificacion.md` → `contract-engineer` deja su veredicto.

**Reglas de transferencia:**

- **`tasks.md` como bus de estado:** cada agente marca su paso; el siguiente lee qué falta. Sobrevive a compactación de contexto.
- **Reports obligatorios** (`changes/<change>/reports/YYYY-MM-DD-step-*.md`): evidencia persistente de QA, transferible entre sesiones.
- **`.claude/` memory del usuario:** decisiones de proyecto duraderas (p.ej. `"codegen elegido = orval tras US-000"`).
- **Regla de transferencia:** un subagente devuelve al orquestador un resumen estructurado (qué hizo, qué falta, dónde están los artefactos), nunca su transcript completo.

---

## 11. CLAUDE.md — cambios

Mantener las reglas críticas actuales (lock atómico, multi-tenancy, máquina de estados, jobs). Añadir:

- Sección **"Harness"**: tabla de agentes y cuándo invocar cada uno.
- Sección **"Flujo de trabajo diario"**: SDD→TDD→impl→QA→docs (resumen de §4).
- Puntero a skills clave y al OpenSpec workflow.
- Regla: `"El cliente HTTP del frontend se genera, nunca se edita a mano (contract-engineer es el dueño)"`.

---

## 12. Workflows operativos diarios

| Comando / flujo | Qué hace |
|---|---|
| `/analizar-backlog` + `/ordenar-backlog` | Regenera el grafo y orden del backlog (ya existen) |
| `"Implementa la siguiente US"` → `harness-orchestrator` | Ejecuta el ciclo completo §4 de una US |
| `openspec propose <us>` (`spec-author`) | Abre un change nuevo |
| `contract-engineer: evoluciona API para US-XX` | Actualiza + valida + regenera SDK |
| `openspec archive <change>` (`spec-author`) | Cierra change, actualiza specs, abre PR |
| `/audit-open-api` | Auditoría puntual del contrato (atajo a la skill) |