---
description: Obliga a incluir los pasos obligatorios de openspec/config.yaml al crear o actualizar artefactos tasks.md, y asegura que el agente ejecuta él mismo todas las pruebas manuales (nunca delega en el usuario).
alwaysApply: true
---

# OpenSpec Tasks: pasos obligatorios

Esta guía es la cara legible para agentes de la **fuente de verdad**
`openspec/config.yaml`. Define qué pasos obligatorios debe incluir todo `tasks.md`
de un change de OpenSpec, en qué orden, y cómo se integran en el flujo del arnés.

> **Regla de oro**: el agente DEBE ejecutar las pruebas él mismo. **Nunca delega
> los tests, los curl ni el E2E en el usuario.**

---

## 0. Antes de crear o actualizar un `tasks.md`: lee `openspec/config.yaml`

**ANTES** de crear o actualizar cualquier `tasks.md`, lee `openspec/config.yaml`
para conocer:

- Los `mandatory_steps` (11 pasos) y su orden.
- La convención de branch: `branching.pattern: feature/{change-name}` desde
  `branching.base: master`.
- La carpeta de reports: `changes.reports_dir: openspec/changes/{change-name}/reports`.
- Los `quality_gates` (pre_commit, contract_validation, pre_archive).
- Los flags `human_review: true` (gates de parada humana) y
  `agent_must_execute: true` (pasos que el agente ejecuta sí o sí).

Si esta guía y `openspec/config.yaml` discreparan, **manda `config.yaml`**.

---

## 1. Los 11 pasos obligatorios (en orden)

Estos son los pasos de `config.yaml`. El flujo del arnés es:

`SDD → ⏸ review-gate-sdd → contrato → TDD-RED → impl (back ∥ front) → QA → code-review → docs → ⏸ review-gate-final → archive/PR`

| # | id (`config.yaml`) | Qué es | Flags | Actor |
|---|--------------------|--------|-------|-------|
| 0 | `step-0` | Crear feature branch `feature/{change-name}` desde `master` (PRIMER paso) | `first: true` | `spec-author` |
| 1 | `review-gate-sdd` | ⏸ **GATE humano**: aprobar `proposal` + spec-delta + `design` ANTES de implementar | `human_review: true` | humano |
| 2 | `tdd-first` | Tests primero (concurrencia del bloqueo, máquina de estados, tarifas) | — | `tdd-engineer` |
| 3 | `step-N` | Revisar y actualizar tests unitarios existentes | — | `backend-developer` / `frontend-developer` |
| 4 | `step-N+1` | Ejecutar unit tests + verificar estado BD + report | `agent_must_execute: true` | `qa-verifier` |
| 5 | `step-N+2` | Pruebas manuales de endpoints con curl (restaurar BD) + report | `agent_must_execute: true` | `qa-verifier` |
| 6 | `step-N+3` | E2E con Playwright MCP (si hay cambios de frontend) + report | `agent_must_execute: true`, `required: false` | `qa-verifier` |
| 7 | `step-N+4` | Actualizar documentación técnica | — | `docs-keeper` |
| 8 | `code-review` | Code review del diff contra guardrails (informe con `Veredicto: APTO/NO APTO`) | `agent_must_execute: true` | `code-reviewer` |
| 9 | `review-gate-final` | ⏸ **GATE humano**: aprobar (code-review APTO + validación manual) ANTES de archive/PR | `human_review: true` | humano |
| 10 | `archive` | Archivar change + abrir PR (solo tras gate final y code-review APTO) | — | `spec-author` |

### Step 0: crear feature branch (DEBE SER EL PRIMERO)

- **Ubicación**: primer paso del `tasks.md`.
- **Nombre**: `feature/{change-name}` (p. ej. `feature/us-001-crear-reserva`).
- **Base**: `master`.
- **Acción**: crear y cambiar a la branch antes de cualquier cambio de código.

---

## 2. Pruebas manuales — CRÍTICO: el agente DEBE ejecutarlas

**IMPORTANTE**: el agente de código (IA) DEBE realizar él mismo todos los pasos de
prueba manual. **Nunca los delega en el usuario.** Solo tras ejecutarlos y crear el
report correspondiente puede marcar la tarea como completada (`[x]`) en `tasks.md`.

Los reports se guardan SIEMPRE en
`openspec/changes/<change-name>/reports/` con el patrón de filename que indica
`config.yaml`.

### `step-N+1`: ejecutar unit tests y verificar estado de la BD

**Responsabilidad del agente**: ejecutar los unit tests, validar la integridad de
la BD antes/después y producir un report. No es opcional ni delegable.

**Pasos** (ejecuta el agente):

1. **Preparar el entorno**: levantar servicios necesarios (BD, dependencias),
   capturar el estado previo de la BD relevante al change (counts, registros
   clave, checksums o snapshots), documentar los comandos exactos a ejecutar.
2. **Tests dirigidos primero**: ejecutar los tests del/los módulo(s) modificados;
   confirmar que se resuelven los fallos y que no hay regresiones en ese alcance.
3. **Suite más amplia**: ejecutar la suite requerida por `config.yaml`
   (`quality_gates.pre_commit` incluye `pnpm test`) o un subconjunto justificado;
   registrar totales, fallos, runtime y cualquier flaky.
4. **Verificar estado posterior de la BD**: revisar los mismos indicadores; si hubo
   mutación no deseada, restaurar el estado y documentar la restauración.
5. **Crear report**: en `openspec/changes/<change-name>/reports/` con el filename
   `YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
6. **Marcar completado**: solo tras tests en verde (o excepciones documentadas y
   aprobadas), BD verificada/restaurada y report creado.

**Plantilla del report**:

```markdown
# Step N+1 — Unit tests y verificación de BD

- Fecha: DD/MM/AAAA
- Change: <change-name>
- Agente: <nombre-del-agente>

## Comandos ejecutados
- `<comando 1>`
- `<comando 2>`

## Resultados de unit tests
- Tests dirigidos: X passed, Y failed, Z skipped
- Suite requerida: X passed, Y failed, Z skipped
- Runtime: <duración>
- Notas: <flaky, reintentos, excepciones>

## Verificación de estado de BD
- Baseline previo:
  - <métrica/tabla/check>: <valor>
- Validación posterior:
  - <métrica/tabla/check>: <valor>
- Estado restaurado: Sí/No
- Acciones de restauración (si las hubo): <acciones>

## Resultado
- Estado de step-N+1: PASS/FAIL
- Bloqueantes: <ninguno o lista>
```

### `step-N+2`: pruebas manuales de endpoints con curl

**Responsabilidad del agente**: ejecutar todos los curl y verificar las respuestas.
No es opcional ni delegable. Report:
`YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`.

**Pasos** (ejecuta el agente):

1. **Preparar entorno**: levantar el backend si hace falta, verificar la conexión a
   BD y anotar el estado de la BD (si se prueban operaciones CREATE/UPDATE/DELETE).
2. **GET** (si los hay): `curl -X GET [url] [headers]`; verificar status y cuerpo.
3. **POST** (CREATE): `curl -X POST [url] -H "Content-Type: application/json" -d '[body]'`;
   verificar status (201/400/422…) y recurso creado. **Restaurar BD**: borrar el
   registro creado.
4. **PUT/PATCH** (UPDATE): verificar status y recurso actualizado. **Restaurar BD**:
   revertir el registro a sus valores originales.
5. **DELETE**: verificar status (200/204/404…) y borrado. **Restaurar BD**: recrear
   el registro con sus valores originales.
6. **Casos de error**: datos inválidos (validación), recursos inexistentes (404),
   acceso no autorizado (si aplica); verificar que el formato de error coincide con
   el contrato OpenAPI.
7. **Marcar completado**: solo tras pasar todos los curl y restaurar la BD,
   documentando comandos y respuestas en el report.

**Notas**:
- Obligatorio para todo endpoint nuevo.
- Toda operación CREATE/UPDATE/DELETE debe dejar la BD en su estado previo.
- No saltarse las pruebas manuales aunque los unit tests pasen.

### `step-N+3`: E2E con Playwright MCP (si hay cambios de frontend)

**Responsabilidad del agente**: ejecutar el E2E con las tools de Playwright MCP.
`required: false` en `config.yaml` (solo aplica con frontend), pero `agent_must_execute: true`
cuando aplica. Report: `YYYY-MM-DD-step-N+3-e2e-playwright.md`.

**Cuándo aplica**: cambios de frontend que afectan flujos de usuario, integración
front↔back, o features que requieren interacción de navegador.

**Pasos** (ejecuta el agente):

1. **Preparar entorno**: levantar frontend y backend, BD en estado conocido,
   comprobar las tools de Playwright MCP disponibles.
2. **Navegar**: `browser_navigate` a la URL; esperar carga; `browser_snapshot` del
   estado inicial.
3. **Ejecutar flujos de usuario**: `browser_click`, `browser_type`/`browser_fill`,
   `browser_snapshot`, `browser_wait`; verificar el resultado esperado en cada paso.
4. **Casos de error**: validación de formularios, mensajes de error, recuperación.
5. **Verificar persistencia**: tras crear/actualizar desde la UI, confirmar que
   persiste y que la BD coincide con la UI.
6. **Restaurar entorno**: limpiar datos de prueba, restaurar la BD, cerrar sesiones
   de navegador.
7. **Marcar completado**: solo tras pasar el E2E y restaurar el entorno.

**Notas**:
- Usar esperas incrementales (1-3 s) con snapshots, en vez de esperas largas.
- Restaurar siempre la BD tras tests que la modifican.

---

## 3. Checklist de verificación del `tasks.md`

Antes de finalizar cualquier `tasks.md`, verifica:

- [ ] `step-0` (crear feature branch) es el PRIMER paso, con nombre `feature/{change-name}`.
- [ ] Están todos los `mandatory_steps` de `config.yaml`, en orden.
- [ ] Los pasos están numerados secuencialmente y marcados `(OBLIGATORIO)`.
- [ ] El gate `review-gate-sdd` aparece tras SDD y antes de implementar.
- [ ] `step-N+1`/`N+2`/`N+3` indican ruta y filename del report en
      `openspec/changes/<change-name>/reports/`.
- [ ] Los pasos manuales indican explícitamente "EL AGENTE DEBE EJECUTARLO".
- [ ] Las tareas incluyen restauración del estado de BD.
- [ ] El paso E2E (`step-N+3`) está si hay cambios de frontend.
- [ ] El paso `code-review` produce informe con `Veredicto: APTO`.
- [ ] El gate `review-gate-final` aparece antes de `archive`/PR.

---

## 4. Cuándo aplica esta guía

Aplica al:

- Crear `tasks.md` con la skill `openspec-propose` o el agente `spec-author`.
- Continuar/actualizar un `tasks.md` existente.
- Cualquier creación de tareas que implique cambios de backend o frontend.
- Implementar tareas con la skill `openspec-apply` (el agente DEBE ejecutar las
  pruebas manuales).

El `harness-orchestrator` coordina el ciclo completo delegando en estos agentes y skills.

---

## 5. Ejemplo de estructura de `tasks.md`

```markdown
## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO)
- [ ] 0.1 Crear branch `feature/us-001-crear-reserva` desde `master`
- [ ] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano proposal + spec-delta + design y ESPERAR su OK explícito

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [ ] 2.1 Escribir tests de concurrencia / máquina de estados / tarifas (en rojo)

## 3. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
...

## 4. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 4.1 Capturar baseline de BD de las entidades impactadas
- [ ] 4.2 Ejecutar tests dirigidos de los módulos cambiados
- [ ] 4.3 Ejecutar la suite requerida (`pnpm test`)
- [ ] 4.4 Verificar estado posterior de BD y restaurar si hace falta
- [ ] 4.5 Crear report `openspec/changes/<change-name>/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 4.6 Marcar completado solo tras tests en verde y report creado

## 5. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 5.1 Levantar el backend
- [ ] 5.2 Probar GET con curl y verificar respuestas
- [ ] 5.3 Probar POST con curl, verificar creación y restaurar BD
- [ ] 5.4 Probar PUT/PATCH con curl, verificar y restaurar BD
- [ ] 5.5 Probar DELETE con curl, verificar y restaurar BD
- [ ] 5.6 Probar casos de error (validación, 404, …)
- [ ] 5.7 Crear report `…/reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 6. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Levantar frontend y backend
- [ ] 6.2 Navegar con `browser_navigate`
- [ ] 6.3 Ejecutar el flujo completo de usuario con las tools de Playwright MCP
- [ ] 6.4 Probar escenarios de error y validación
- [ ] 6.5 Verificar persistencia y estado de la UI
- [ ] 6.6 Restaurar entorno y estado de BD
- [ ] 6.7 Crear report `…/reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
...

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 8.1 Ejecutar `code-reviewer` sobre el diff
- [ ] 8.2 Dejar informe `…/reports/YYYY-MM-DD-step-review-code-review.md` con `Veredicto: APTO`

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 9.1 Tras code-review APTO + validación manual, ESPERAR el OK humano

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 10.1 `openspec archive <change>` y abrir PR (solo tras gate final y APTO)
```

---

## 6. Requisitos de ejecución del agente

Al implementar tareas de `tasks.md` (skill `openspec-apply`), el agente DEBE:

1. **Ejecutar todas las pruebas manuales**: levantar servidores, ejecutar curl,
   ejecutar E2E con Playwright MCP, verificar respuestas y restaurar la BD.
2. **Marcar `[x]` solo tras**: ejecutar los tests con éxito, verificar resultados,
   restaurar la BD (para CREATE/UPDATE/DELETE) y documentar el resultado en el report.
3. **Nunca delegar**: no pedir al usuario que ejecute curl, pruebe endpoints o corra
   el E2E; no marcar tareas sin ejecutar; no saltarse pasos manuales.
4. **Documentar la ejecución**: comandos curl, respuestas, escenarios E2E, acciones
   de restauración de BD y cualquier incidencia con su resolución.

---

## 7. Gates de revisión humana

### Gate tras SDD (`review-gate-sdd`)

Tras crear el change (`proposal` + spec-delta + `design`) y **antes de implementar**
(contrato/TDD/impl), el flujo **se detiene**.

- **Posición**: justo después de `step-0` (branch), antes de `tdd-first`.
- **Responsabilidad del agente**: presentar un resumen de `proposal.md`, el
  spec-delta y `design.md`, y **esperar el OK explícito** del humano. No avanzar por
  defecto, ni aunque la US parezca trivial o el usuario haya dicho "continúa".
- **Por qué**: es el momento barato de corregir alcance/diseño; una vez implementado
  y archivado, cambiarlo exige un nuevo change.

### Code review obligatorio + gate final (`review-gate-final`)

Antes de cerrar el change, el `code-reviewer` es **obligatorio** y hay un segundo
gate humano.

- **Paso `code-review`** (`agent_must_execute: true`): el `code-reviewer` revisa el
  diff contra los guardrails y deja un informe en
  `openspec/changes/<change>/reports/YYYY-MM-DD-step-review-code-review.md`.
  - **Convención del veredicto**: el informe DEBE incluir la línea literal
    `Veredicto: APTO` o `Veredicto: NO APTO`. Si es NO APTO o hay bloqueantes, se
    vuelve a implementación y se repite.
- **Paso `review-gate-final`** (`human_review: true`): tras un code-review APTO y la
  validación manual, el flujo **se detiene** para el OK humano antes de
  `openspec archive`/PR.

---

## 8. Enforcement por hooks (no son sugerencias)

Configurados en `.claude/settings.json` (`scripts/hooks/`):

- **`require-code-review.py`** (PreToolUse sobre Bash): **bloquea** `openspec archive`
  y `gh pr create|merge` si no existe un informe `*code-review*.md` con
  `Veredicto: APTO` en `openspec/changes/<change>/reports/`. La regex que lee es
  `Veredicto:\s*(NO\s+APTO|APTO)`. Para desbloquear: ejecutar el `code-reviewer` y
  dejar el informe con `Veredicto: APTO`. Ver `quality_gates.pre_archive` en
  `config.yaml`.
- **`require-tests-first.py`**: bloquea implementar lógica crítica (`domain/`,
  `application/`, `*.use-case.ts`, `*.entity.ts`, `maquina-estados.ts`) sin su test
  hermano (`.spec.ts`/`.test.ts`). Para desbloquear: escribir primero el test (RED).
- **`no-infra-in-domain.py`**: bloquea imports de framework/infra en `domain/`.
- **`no-distributed-lock.py`**: bloquea Redis/Redlock/locks distribuidos (el bloqueo
  de fecha es atómico vía PostgreSQL + Prisma).
- **`protect-generated-client.py`**: bloquea editar a mano el cliente generado.
- **`validate-openapi.py`**: valida el contrato al editar `docs/api-spec.yml`.

---

## 9. Si no se siguen estos pasos

Si creas un `tasks.md` sin estos pasos obligatorios, el usuario tendrá que
corregirlo a mano. Lee siempre `openspec/config.yaml` primero e incluye todos los
pasos.

**Si implementas tareas sin ejecutar tú mismo las pruebas manuales, estás violando
esta regla. El agente DEBE ejecutar todas las pruebas para marcar las tareas como
completadas.**
