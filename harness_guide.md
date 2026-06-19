# Guía del Harness de Slotify

> Manual de referencia y uso del harness de Claude Code para desarrollar Slotify
> con metodología **SDD (Spec-Driven Development) + TDD (Test-Driven Development)**.
> Complementa a [CLAUDE.md](CLAUDE.md) y a la documentación de [`docs/`](docs/).

## Índice

- [Parte 1 — Referencia](#parte-1--referencia)
  - [1. Para qué sirve el harness](#1-para-qué-sirve-el-harness)
  - [2. Arquitectura en capas](#2-arquitectura-en-capas)
  - [3. Mapa de agentes](#3-mapa-de-agentes)
  - [4. Catálogo de skills](#4-catálogo-de-skills)
  - [5. Hooks de enforcement](#5-hooks-de-enforcement)
  - [6. OpenSpec (motor SDD)](#6-openspec-motor-sdd)
  - [7. Commands y tooling determinista](#7-commands-y-tooling-determinista)
  - [8. MCPs](#8-mcps)
  - [9. El flujo canónico](#9-el-flujo-canónico)
- [Parte 2 — Ejemplos end-to-end](#parte-2--ejemplos-end-to-end)
  - [Ejemplo A — US Spine completa (backend + frontend)](#ejemplo-a--us-spine-completa-backend--frontend)
  - [Ejemplo B — Evolución de contrato (fix F1-01)](#ejemplo-b--evolución-de-contrato-fix-f1-01)
  - [Ejemplo C — Feature de frontend desde Figma](#ejemplo-c--feature-de-frontend-desde-figma)
  - [Ejemplo D — Backlog + scaffolding US-000 (y hooks bloqueando)](#ejemplo-d--backlog--scaffolding-us-000-y-hooks-bloqueando)
- [Parte 3 — Operativa y referencia rápida](#parte-3--operativa-y-referencia-rápida)

---

# Parte 1 — Referencia

## 1. Para qué sirve el harness

Slotify es un SaaS multi-tenant de gestión de espacios de eventos privados. El harness
es el conjunto de **agentes, skills, hooks, specs y configuración** que convierte a Claude
Code en un equipo de desarrollo especializado que construye Slotify de forma **consistente,
trazable y automatizada**, en lugar de un asistente generalista que improvisa.

**Problema que resuelve.** Sin harness, cada feature se implementa de forma distinta: se
olvidan los tests, se cuelan violaciones de arquitectura (un `import` de Prisma en el
dominio, un lock con Redis), el contrato OpenAPI se desincroniza del frontend y la
documentación se queda obsoleta. El harness hace que el **camino correcto sea el camino por
defecto** y, donde importa, el **único posible** (los hooks bloquean lo demás).

**Metodología.** Cada feature recorre el ciclo:

```
SDD (spec)  →  Contrato (OpenAPI)  →  TDD-RED (tests)  →  Implementación  →  QA  →  Review  →  Docs  →  Archive/PR
```

**Principios de diseño.**

| Principio | Cómo se materializa |
|-----------|---------------------|
| **Contrato como fuente de verdad** | `docs/api-spec.yml` se congela y valida antes de implementar; el cliente del frontend se **genera**, nunca se edita a mano. |
| **TDD estricto en el núcleo** | Los tests de concurrencia del bloqueo atómico y de la máquina de estados se escriben **primero**; un hook bloquea implementar lógica crítica sin test. |
| **Bajo consumo de contexto** | Los agentes no leen `docs/` entero: usan la skill `slotify-context` como router y cargan solo el slice necesario. Los subagentes devuelven conclusiones, no transcripts. |
| **Enforcement, no sugerencia** | Donde el prompt "recomienda", los hooks **bloquean** (arquitectura hexagonal, bloqueo atómico, cliente generado). |
| **Separación de responsabilidades** | 9 agentes con responsabilidades disjuntas y permisos mínimos. |
| **Estado en disco** | El progreso vive en `openspec/changes/<change>/tasks.md` y `reports/`, no en la conversación: sobrevive a la compactación de contexto. |

## 2. Arquitectura en capas

```
┌─ CLAUDE.md (router) ──── contexto mínimo + tabla "para X invoca agente Y / skill Z"
│
├─ OpenSpec (SDD) ──────── openspec/ = fuente de verdad de specs y changes
│     specs/<capability>/ · changes/<change>/{proposal, tasks, design, reports}
│
├─ Agentes (.claude/agents) ── 9 ejecutores especializados, contexto aislado
│     orquestador → spec → contrato → tests → back/front → QA → review → docs
│
├─ Skills (.claude/skills) ──── 27 tarjetas de conocimiento, cargadas on-demand
│
├─ Hooks (.claude/settings.json + scripts/hooks) ── enforcement determinista
│     PreToolUse (bloquea) · PostToolUse (valida)
│
└─ MCP ──────────────────── Figma · Playwright · GitHub · Context7
```

**Idea central.** El agente principal **orquesta**; los subagentes **ejecutan** en contexto
aislado y devuelven un resumen. Así el hilo principal se mantiene ligero y el trabajo pesado
(lecturas, implementación, tests) vive y muere dentro de cada subagente.

## 3. Mapa de agentes

Definidos en `.claude/agents/*.md`. Cada uno declara `tools` mínimas y carga su contexto vía
skills (no precargado).

| Agente | Rol — cuándo invocarlo | Tools / MCP | Skills que carga | Model |
|--------|------------------------|-------------|------------------|-------|
| **harness-orchestrator** | Punto de entrada. "Implementa la siguiente US" / coordinar una feature de principio a fin. **No** escribe código. | Task, Read, Bash, TodoWrite, Glob, Grep | `slotify-context`, `openspec-workflow` | opus |
| **spec-author** | Abrir/archivar un *change* de OpenSpec (proposal, spec-delta, tasks.md). Garantiza Step 0 (branch) y pasos obligatorios. | Read, Write, Edit, Bash, Glob, Grep | `openspec-propose`, `openspec-archive`, `us-traceability`, `slotify-domain` | opus |
| **contract-engineer** | Dueño del contrato OpenAPI: auditar, evolucionar, validar, generar SDK, sincronizar back↔front. | Read, Edit, Write, Bash, Glob, Grep | `openapi-governance`, `contract-sync`, `sdk-codegen` | opus |
| **tdd-engineer** | Escribe tests **primero** (RED): concurrencia del lock, máquina de estados, tarifas. **No** escribe código de producción. | Read, Write, Edit, Bash, Glob, Grep | `tdd-core`, `concurrency-locking`, `state-machine` | opus |
| **backend-developer** | Implementa NestJS/Prisma hexagonal hasta poner los tests en verde (GREEN). | Read, Edit, Write, Bash, Glob, Grep | `hexagonal-ddd`, `atomic-date-lock`, `multi-tenancy-rls`, `state-machine`, `async-jobs` | opus |
| **frontend-developer** | Implementa React/Tailwind/shadcn consumiendo **Figma (MCP)** y el cliente generado. | Read, Edit, Write, Bash, Glob, Grep + **Figma MCP** | `figma-design-consume`, `frontend-feature`, `shadcn-tailwind`, `tanstack-forms` | opus |
| **qa-verifier** | Ejecuta él mismo unit + curl + Playwright + reports. **Nunca** delega tests al usuario. | Read, Write, Bash, Glob, Grep + **Playwright MCP** | `qa-mandatory-steps`, `db-state-verify` | sonnet |
| **code-reviewer** | Revisa el diff contra los guardrails. Salida = **informe** (no auto-fix). | Read, Bash, Glob, Grep | `review-checklist`, `architecture-guardrails` | opus |
| **docs-keeper** | Sincroniza `docs/` tras el cambio (consistencia cruzada). Escribe solo en `docs/`. | Read, Edit, Bash, Glob, Grep | `doc-sync`, `slotify-domain` | sonnet |

## 4. Catálogo de skills

Definidas en `.claude/skills/<nombre>/SKILL.md`. Son tarjetas de referencia (~40-90 líneas)
que se cargan **on-demand**, no en el system prompt.

**Dominio / contexto**
- `slotify-context` — router de docs: qué documento leer para qué pregunta (clave para bajo consumo de contexto).
- `slotify-domain` — lenguaje ubicuo, 17 entidades, máquina de estados.

**OpenSpec (SDD)**
- `openspec-workflow` — ciclo propose→apply→archive→sync.
- `openspec-propose` — abrir change: branch, proposal, spec-delta, tasks.md.
- `openspec-apply` — implementar tasks; marcar `[x]` solo tras verificar.
- `openspec-archive` — cerrar change y actualizar specs vivas.
- `openspec-sync-specs` — coherencia specs ↔ código ↔ contrato.
- `us-traceability` — trazabilidad US↔API↔ER↔UC; elegir la siguiente historia.

**Arquitectura backend**
- `hexagonal-ddd` — 4 capas, regla de dependencia, puertos/adaptadores.
- `atomic-date-lock` — `UNIQUE(tenant_id, fecha)` + `SELECT FOR UPDATE` (regla crítica).
- `state-machine` — transiciones como tabla declarativa + `puedeTransicionar()`.
- `multi-tenancy-rls` — `tenant_id` del JWT, RLS, `@TenantId()`.
- `async-jobs` — estado en fila + barrido idempotente.

**Contrato**
- `openapi-governance` — auditoría del contrato (las 5 comprobaciones; absorbe `/audit-open-api`).
- `contract-sync` — sincronización backend DTOs ↔ cliente generado.
- `sdk-codegen` — elección/uso del generador (orval vs openapi-typescript).

**Testing / QA**
- `tdd-core` — ciclo RED→GREEN→REFACTOR, orden de prioridad.
- `concurrency-locking` — tests de concurrencia del lock (`Promise.allSettled`).
- `qa-mandatory-steps` — unit + curl + Playwright + reports (agente ejecuta).
- `db-state-verify` — baseline pre/post y restauración de BD.

**Frontend**
- `frontend-feature` — estructura por dominio, TanStack Query, tipos generados.
- `figma-design-consume` — flujo de consumo de diseños vía MCP de Figma.
- `shadcn-tailwind` — componentes shadcn sobre Tailwind con tokens de Figma.
- `tanstack-forms` — React Hook Form + Zod + useMutation; errores 400/409/422.

**Transversal**
- `review-checklist` — checklist de revisión (solo lectura).
- `architecture-guardrails` — las 6 reglas duras innegociables.
- `doc-sync` — consistencia cruzada de documentación.

## 5. Hooks de enforcement

Configurados en `.claude/settings.json`; scripts en `scripts/hooks/` (Python 3, leen el JSON
del hook por stdin; `exit 2` = bloqueo y el mensaje se muestra al modelo para que corrija).

| Evento | Matcher | Script | Qué hace |
|--------|---------|--------|----------|
| PreToolUse | Edit\|Write | `no-infra-in-domain.py` | **Bloquea** imports de `@nestjs/*`, `@prisma/client` o `infrastructure/` en ficheros bajo `apps/api/**/domain/**`. |
| PreToolUse | Edit\|Write | `no-distributed-lock.py` | **Bloquea** introducir Redis/Redlock/ioredis/SETNX/locks distribuidos en `apps/api`. |
| PreToolUse | Edit\|Write | `protect-generated-client.py` | **Bloquea** editar a mano `apps/web/src/api-client/**` (cliente generado). |
| PreToolUse | Edit\|Write | `require-tests-first.py` | **Bloquea** implementar lógica crítica (`domain/`, `application/`, `*.use-case.ts`, `*.entity.ts`, `maquina-estados.ts`) sin un test hermano. Excluye scaffolding (módulos, DTOs). |
| PostToolUse | Edit\|Write | `validate-openapi.py` | Tras editar `api-spec.yml`: valida con spectral/redocly (o YAML básico) y recuerda regenerar el SDK. |

`_util.py` es el helper compartido (parseo de stdin, `block()`, `ok()`).

> **Importante**: que un hook bloquee **no es un error** — es el guardrail funcionando. El
> mensaje te dice qué regla violaste y cómo corregir.

## 6. OpenSpec (motor SDD)

Estructura en `openspec/`:

```
openspec/
  config.yaml          # pasos obligatorios, branching, quality gates
  project.md           # contexto del proyecto para OpenSpec
  specs/<capability>/  # specs vivas (la verdad de lo construido)
  changes/<change>/    # un cambio en curso:
      proposal.md      #   qué cambia y por qué (trazable a US/UC)
      tasks.md         #   pasos en orden + obligatorios (bus de estado [ ]/[x])
      design.md        #   opcional: decisiones técnicas no triviales
      reports/         #   evidencia de QA (uno por step)
```

**Pasos obligatorios de todo `tasks.md`** (de `openspec/config.yaml` y
`docs/openspec-tasks-mandatory-steps.md`):

1. **Step 0** — crear feature branch `feature/<change-name>` (lo primero).
2. **TDD primero** — tests antes de implementar.
3. **Step N** — revisar/actualizar tests unitarios.
4. **Step N+1** — ejecutar unit tests + verificar estado BD + report.
5. **Step N+2** — pruebas manuales con curl (el agente ejecuta, restaura BD) + report.
6. **Step N+3** — E2E con Playwright MCP si hay frontend + report.
7. **Step N+4** — actualizar documentación técnica.

Una tarea se marca `[x]` **solo** tras ejecutarla y verificarla. Nunca se delega el testing al usuario.

## 7. Commands y tooling determinista

Definidos en `.claude/commands/`:

- **`/analizar-backlog`** — ejecuta `scripts/extract_backlog.py` (determinista, sin LLM): lee
  `user-stories/US-*.md` y produce `user-stories/_analisis.json` con el grafo de dependencias
  (fan_out, ciclos, huérfanos, profundidad).
- **`/ordenar-backlog`** — lee `_analisis.json` y produce `user-stories/_backlog.json` ordenado
  por dependencias y criticidad (Fundacional → Spine → Soporte). No asigna sprints.
- **`/audit-open-api`** — auditoría puntual del contrato (atajo de la skill `openapi-governance`);
  escribe el informe en `docs/audits/openapi-verificacion.md`.

## 8. MCPs

| MCP | Lo usa | Para qué |
|-----|--------|----------|
| **Figma** | `frontend-developer` | `get_metadata`, `get_design_context`, `get_variable_defs` (tokens), `get_screenshot`, `get_code_connect_map`. Diseño → código. |
| **Playwright** | `qa-verifier` | E2E: `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`. |
| **GitHub** | `spec-author`, orquestador | Abrir PR, issues, revisar estado. |
| **Context7** | cualquier agente | Documentación al día de NestJS/Prisma/TanStack en vez de adivinar de memoria. |

## 9. El flujo canónico

```
[0] harness-orchestrator   lee _backlog.json → siguiente US
[1] SDD          spec-author        → change OpenSpec (branch, proposal, tasks)   [gate: openspec validate]
[2] Contrato     contract-engineer  → evoluciona+valida api-spec.yml, regenera SDK [gate: spectral lint]   (si toca API)
[3] TDD-RED      tdd-engineer       → tests primero, deben FALLAR                  [gate: require-tests-first]
[4] Impl         backend-developer ∥ frontend-developer  (paralelo tras congelar contrato)
[5] QA           qa-verifier        → unit + curl + Playwright + reports
[6] Review       code-reviewer      → informe contra guardrails
[7] Docs         docs-keeper        → sincroniza docs/
[8] Archive      spec-author        → openspec archive + PR
```

**Gates duros (secuenciales, no se saltan)**: SDD → Contrato → TDD-RED. No se implementa sin
tests rojos. **Frontera de paralelización**: el contrato + SDK generado es lo que permite a
backend y frontend avanzar a la vez sin pisarse, por eso el contrato se **congela antes**.

---

# Parte 2 — Ejemplos end-to-end

> En todos los ejemplos, lo que **tecleas** va en bloque; el resto narra qué hacen los agentes,
> qué artefactos aparecen y qué hooks se disparan.

## Ejemplo A — US Spine completa (backend + frontend)

**Objetivo.** Implementar una historia del camino feliz que toca el núcleo crítico:
*"confirmar una reserva y bloquear su fecha"* (toca `reservas`, `calendario`, el bloqueo
atómico y una pantalla de confirmación). Es el ejemplo que ejercita **todo** el harness.

**Lo que tecleas:**

```
Implementa la siguiente US del backlog con el harness-orchestrator.
```

**Qué ocurre, paso a paso:**

1. **Orquestación** — `harness-orchestrator` lee `user-stories/_backlog.json`, elige la
   primera US no completada con dependencias resueltas (p.ej. `US-017 Confirmar reserva`) y
   abre un `TodoWrite` con las fases. No escribe código: delega.

2. **SDD** — delega en `spec-author`:
   - Step 0: crea la rama `feature/confirmar-reserva`.
   - Crea `openspec/changes/confirmar-reserva/` con `proposal.md` (trazable a US-017 / UC-17),
     spec-delta de la capability `reservas`, y `tasks.md` con los pasos obligatorios.
   - `openspec validate --strict` ✅ (gate 1).

3. **Contrato** — delega en `contract-engineer` (la US expone `POST /reservas/{id}/transiciones`):
   - Evoluciona `docs/api-spec.yml` (acción de transición, body, respuestas 200/409/422).
   - `spectral lint docs/api-spec.yml` ✅ (gate 2). Al guardar, salta el hook **`validate-openapi`**
     (PostToolUse) que confirma el contrato y recuerda regenerar el SDK.
   - `pnpm generate:api` regenera `apps/web/src/api-client/`. **Congela el contrato.**

4. **TDD-RED** — delega en `tdd-engineer`:
   - Escribe primero los tests de concurrencia del bloqueo (`bloquear-fecha.use-case.spec.ts`)
     y de la transición `reserva_confirmada` (`maquina-estados.spec.ts`).
   - Ejecuta `pnpm test`: **fallan** (RED), como debe ser (gate 3). El hook
     **`require-tests-first`** garantiza que estos tests existan antes de implementar.

   ```ts
   it('debe_rechazar_segunda_reserva_cuando_fecha_ya_bloqueada', async () => {
     const r = await Promise.allSettled([
       bloquear.ejecutar(tenantId, fecha, reservaA),
       bloquear.ejecutar(tenantId, fecha, reservaB),
     ]);
     expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1); // 1 OK
     expect(r.filter(x => x.status === 'rejected')).toHaveLength(1);  // 1 → 409
   });
   ```

5. **Implementación en paralelo** (contrato ya congelado) — el orquestador lanza en **un solo
   mensaje** dos subagentes:
   - `backend-developer`: implementa `bloquearFecha()` (UNIQUE + `SELECT FOR UPDATE` en
     `$transaction`), la transición en la tabla `TRANSICIONES`, el caso de uso y el controlador,
     hasta poner los tests en **verde** (GREEN). Los hooks `no-infra-in-domain` y
     `no-distributed-lock` vigilan en silencio (no se disparan si el código es correcto).
   - `frontend-developer`: pantalla de confirmación con shadcn + TanStack Query `useMutation`
     sobre el cliente generado; mapea el 409 ("la fecha ya está bloqueada") a un mensaje en español.

6. **QA** — delega en `qa-verifier`:
   - Step N+1: `pnpm test` + baseline/post de BD → `reports/2026-..-step-N+1-unit-test-and-db-verification.md`.
   - Step N+2: curl a `POST /reservas/{id}/transiciones` (200, y 409 al repetir la fecha),
     restaura BD → report.
   - Step N+3: Playwright navega la pantalla, confirma la reserva, verifica persistencia → report.

7. **Review** — `code-reviewer` revisa el diff contra los guardrails y emite informe: *apto/no apto*.

8. **Docs** — `docs-keeper` sincroniza `data-model.md`/`api-spec.yml`/standards si cambió algo.

9. **Archive** — `spec-author` marca `tasks.md` completo, `openspec archive confirmar-reserva`
   y abre el PR (GitHub MCP).

**Resultado.** Feature implementada con tests de concurrencia verdes, reports de QA en
`openspec/changes/confirmar-reserva/reports/`, docs sincronizadas y PR abierto. Back y front
se construyeron en paralelo sin conflictos gracias al contrato congelado.

---

## Ejemplo B — Evolución de contrato (fix F1-01)

**Objetivo.** Arreglar un hallazgo real de la auditoría OpenAPI: **F1-01** — *no existe
endpoint/campo para asignar `fecha_evento` a una consulta*, lo que **bloquea UC-05** (poner
fecha a la consulta y activar el bloqueo atómico). Es el ejemplo **contract-first**: el cambio
nace en el contrato, no en el código.

**Lo que tecleas:**

```
Con el contract-engineer, resuelve el hallazgo F1-01 de docs/audits/openapi-verificacion.md:
añade al contrato la forma de asignar fecha_evento a una consulta (UC-05) y sincroniza back y front.
```

**Qué ocurre:**

1. **Auditoría / diagnóstico** — `contract-engineer` carga `openapi-governance`, relee
   `docs/audits/openapi-verificacion.md` y `docs/er-diagram.md`, y confirma F1-01: falta un
   `PATCH /reservas/{id}` (o acción dedicada) que acepte `fecha_evento`, y el schema `Reserva`
   no proyecta el campo de forma editable.

2. **Evolución del contrato** — edita `docs/api-spec.yml`:
   - Añade el campo `fecha_evento` (formato `date`) donde corresponde y la operación que lo asigna.
   - Documenta respuestas: `200` (asignada), `409` (fecha ya bloqueada — dispara el lock atómico),
     `422` (estado de consulta no admite fecha).
   - Al guardar, el hook **`validate-openapi`** (PostToolUse) ejecuta `spectral lint`. Si algo
     queda inválido, **bloquea** con el detalle y el agente corrige antes de seguir.

3. **Regeneración del SDK** — `pnpm generate:api` actualiza `apps/web/src/api-client/`.
   > Si en este punto el agente intentara *editar a mano* el cliente, el hook
   > **`protect-generated-client`** lo **bloquea**:
   > ```
   > BLOQUEADO: edición manual del cliente generado (apps/web/src/api-client/index.ts).
   > Este cliente se regenera con `pnpm generate:api` desde docs/api-spec.yml...
   > ```

4. **Sincronización backend** — actualiza el DTO `@nestjs/swagger` y el caso de uso para que el
   contrato real del backend coincida con `api-spec.yml`. Aquí entra el TDD: antes de tocar el
   caso de uso, `tdd-engineer` añade el test de "asignar fecha bloquea la fecha" (si no existe,
   `require-tests-first` lo exige).

5. **Cierre** — `contract-engineer` re-ejecuta la auditoría: F1-01 pasa de *Bloqueante* a
   *resuelto* en `docs/audits/openapi-verificacion.md`. `docs-keeper` sincroniza el resto de docs.

**Resultado.** El contrato vuelve a ser trazable a UC-05, el SDK y los DTOs están sincronizados,
y el cambio quedó gobernado de punta a punta por el dueño del contrato. Ningún artefacto generado
se editó a mano.

---

## Ejemplo C — Feature de frontend desde Figma

**Objetivo.** Construir una pantalla nueva — la **vista de detalle de una reserva** — a partir
de su diseño en Figma, sin backend nuevo (el endpoint ya existe). Ejemplo del uso del **MCP de
Figma** y del consumo del cliente generado.

**Lo que tecleas** (con el link del nodo de Figma):

```
Con el frontend-developer, implementa la pantalla de detalle de reserva a partir de este diseño:
https://www.figma.com/design/XXXX/Slotify?node-id=120-45
```

**Qué ocurre:**

1. **Lectura del diseño (Figma MCP)** — `frontend-developer` carga `figma-design-consume` y:
   - `get_metadata` del nodo → entiende la jerarquía (cabecera, datos del cliente, estado,
     timeline, acciones).
   - `get_design_context` + `get_variable_defs` → obtiene layout y **design tokens** (colores,
     espaciados, tipografía). **No se hardcodean valores**: se usan los tokens.
   - `get_screenshot` → referencia visual para comparar.
   - `get_code_connect_map` → si el botón/badge ya está mapeado a un componente del código, lo
     **reutiliza** en vez de recrearlo. (Antes de cualquier escritura con `use_figma`, carga la
     skill `/figma-use` del plugin.)

2. **Implementación** — crea la feature bajo `apps/web/src/reservas/` (estructura por dominio):
   - Componentes con **shadcn/ui + Tailwind** usando los tokens de Figma.
   - Datos con **TanStack Query** (`useQuery`) sobre el **cliente generado** — sin inventar tipos
     de API. El estado de la reserva se pinta desde el enum del contrato.
   - Estados de carga/error y formato de importes en `Decimal`/EUR.

3. **Verificación visual y E2E** — `qa-verifier` (Playwright MCP) navega a la pantalla, comprueba
   que renderiza los datos y que coincide con el screenshot de referencia; genera el report.

**Resultado.** Pantalla fiel al diseño, construida con tokens (no magic numbers), tipos seguros
desde el contrato y validada visualmente. Si el diseño cambia en Figma, se vuelve a consumir el
nodo y se ajusta.

---

## Ejemplo D — Backlog + scaffolding US-000 (y hooks bloqueando)

**Objetivo.** Arrancar el proyecto **de cero**: fijar el orden de construcción y crear el
andamiaje (monorepo, Prisma, jest, cliente API). Además, **ver los hooks en acción** bloqueando
violaciones. Ejemplo de planificación + el rol de los guardrails.

**Paso 1 — Ordenar el backlog (tooling determinista):**

```
/analizar-backlog
/ordenar-backlog
```

`/analizar-backlog` ejecuta `scripts/extract_backlog.py` y produce `user-stories/_analisis.json`
(grafo de dependencias: 0 ciclos, US-000 con fan_out 44). `/ordenar-backlog` produce
`user-stories/_backlog.json` con el orden Fundacional → Spine → Soporte. **US-000 (scaffolding)
sale primero** por su alto fan_out.

**Paso 2 — Abrir el change de US-000:**

```
Con el spec-author, abre el change para US-000 (scaffolding del monorepo).
```

`spec-author` crea la rama `feature/scaffolding`, y `openspec/changes/scaffolding/` con
`proposal.md` y `tasks.md` (monorepo pnpm, `apps/api` NestJS, `apps/web` Vite, `prisma/schema.prisma`,
jest, script `generate:api`). En `tasks.md`, la elección del generador SDK queda como tarea para
`contract-engineer` (orval vs openapi-typescript, ver skill `sdk-codegen`).

**Paso 3 — Los hooks protegen la arquitectura desde el primer commit.**

Supón que durante la implementación un agente (o tú) intenta atajar. Estos son los **bloqueos
reales** (mensajes ya verificados):

- Meter un framework en el dominio:
  ```
  # Intento: import { Injectable } from "@nestjs/common"  en apps/api/src/reservas/domain/reserva.entity.ts
  GUARDRAIL HEXAGONAL bloqueado: @nestjs/* (framework) en domain.
  El dominio NO importa framework ni infraestructura: depende solo de sus puertos...
  ```

- Resolver el bloqueo de fecha con Redis:
  ```
  # Intento: import Redlock from "redlock"  en apps/api/src/calendario/infrastructure/lock.ts
  GUARDRAIL BLOQUEO ATÓMICO bloqueado: detectado Redlock.
  El bloqueo de fecha NO usa Redis ni locks distribuidos. Usa UNIQUE(tenant_id, fecha) + SELECT ... FOR UPDATE...
  ```

- Editar a mano el cliente generado:
  ```
  # Intento: editar apps/web/src/api-client/index.ts
  BLOQUEADO: edición manual del cliente generado.
  Este cliente se regenera con `pnpm generate:api` desde docs/api-spec.yml...
  ```

- Implementar un caso de uso del núcleo sin test:
  ```
  # Intento: crear apps/api/src/reservas/application/bloquear-fecha.use-case.ts sin spec
  TDD bloqueado: vas a implementar lógica crítica sin test.
  Escribe primero el test (bloquear-fecha.use-case.spec.ts) con el agente tdd-engineer...
  ```

**Resultado.** El backlog queda ordenado por dependencias, el andamiaje se crea dentro de un
change trazable, y desde la primera línea de código los hooks garantizan que la arquitectura
hexagonal, el bloqueo atómico, el contrato y el TDD **no se puedan violar por accidente**.

---

# Parte 3 — Operativa y referencia rápida

## Cheat-sheet — "quiero X → teclea Y"

| Quiero… | Teclea / invoca |
|---------|-----------------|
| Implementar la siguiente historia completa | "Implementa la siguiente US con el harness-orchestrator" |
| Ordenar / refrescar el backlog | `/analizar-backlog` y luego `/ordenar-backlog` |
| Auditar el contrato OpenAPI | `/audit-open-api` (o "con el contract-engineer, audita…") |
| Cambiar/añadir un endpoint | "con el contract-engineer, evoluciona el contrato para…" |
| Escribir tests antes de implementar | "con el tdd-engineer, escribe los tests de…" |
| Implementar lógica backend | "con el backend-developer, implementa…" |
| Construir una pantalla desde Figma | "con el frontend-developer, implementa <pantalla> desde <link Figma>" |
| Ejecutar QA de un change | "con el qa-verifier, ejecuta los pasos obligatorios de QA" |
| Revisar antes de mergear | "con el code-reviewer, revisa el diff" |
| Sincronizar la documentación | "con el docs-keeper, sincroniza los docs" |
| Abrir/archivar un change | "con el spec-author, abre/archiva el change de…" |

## Buenas prácticas de uso

- **Delega en el orquestador** para features completas; invoca agentes sueltos solo para tareas acotadas.
- **No te saltes los gates**: SDD → Contrato → TDD-RED son secuenciales por una razón.
- **Deja que `qa-verifier` ejecute** los tests; nunca los marques como hechos sin sus reports.
- **El cliente del frontend se regenera, no se edita**: si está desfasado, evoluciona el contrato.
- **El contrato se congela antes** de paralelizar backend y frontend.

## Troubleshooting

- **"Un hook me bloqueó"** — no es un bug: es el guardrail. Lee el mensaje, corrige la causa
  (mueve la dependencia fuera del dominio, usa el lock nativo, regenera el cliente, escribe el
  test primero) y reintenta.
- **"Quiero retomar un change a medias"** — el estado vive en disco: mira el `tasks.md` del change
  (casillas `[ ]/[x]`) y los `reports/` ya generados. El `harness-orchestrator` reanuda desde ahí
  sin perder contexto, aunque la conversación se haya compactado.
- **"El contrato y el código no coinciden"** — es trabajo del `contract-engineer`; no "arregles"
  el doc para que cuadre. Escala el desajuste y deja que el dueño del contrato decida la fuente de verdad.

---

*Documento de referencia del harness. Consistente con [CLAUDE.md](CLAUDE.md), los agentes en
`.claude/agents/`, las skills en `.claude/skills/`, los hooks en `scripts/hooks/` y la
configuración de `openspec/`.*
