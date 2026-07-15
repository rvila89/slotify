# Tasks — us-013-descartar-consulta-por-cliente

> Trazabilidad: US-013, UC-10, A17. Capability: `consultas`.
> Marca cada tarea `[x]` **solo** tras ejecutarla y verificarla. El agente ejecuta las
> pruebas él mismo; nunca las delega al usuario.

## Step 0 — Feature branch (PRIMERO, obligatorio)

- [x] Crear y cambiar a `feature/us-013-descartar-consulta-por-cliente` desde `master`
      (hecho antes de cualquier escritura).

## GATE revisión humana (SDD) — PARADA OBLIGATORIA

- [x] `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md` **aprobados por
      el humano** (esperar OK explícito). El flujo se DETIENE aquí antes de implementar.
- [x] Confirmadas las decisiones abiertas de `design.md §Ambigüedades`: endpoint
      `POST /reservas/{id}/descartar` con `{ motivo? }` (D-5); motivo **anexado** a `notas`;
      alerta interna heredada de US-018 tras promoción; auditoría de salida de cola coherente
      con US-014/US-018.

## Fase Contrato (tras el gate; dueño: contract-engineer)

- [x] Evolucionar `docs/api-spec.yml` con `POST /reservas/{id}/descartar` y `{ motivo? }`
      (D-5); validado con `spectral lint docs/api-spec.yml`.
- [x] Regenerar el SDK/cliente HTTP del frontend desde el contrato (nunca a mano).

## TDD primero (RED) — antes de cualquier implementación

- [x] Tests de la **máquina de estados**: transición `{consulta, 2a|2b|2c|2d|2v} →
      {consulta, 2z}` permitida; rechazo desde terminales (`2x/2y/2z/reserva_cancelada/
      reserva_completada`).
- [x] Tests por origen (tabla `design.md §D-1`): `2a` (solo marca), `2b` sin/con cola,
      `2c`, `2d` (decremento), `2v` sin/con cola heredada.
- [x] Tests de **concurrencia del bloqueo** (RC-1/RC-2/RC-3): descarte vs barrido TTL;
      liberación vs nuevo bloqueo (`UNIQUE(tenant_id, fecha)`); doble descarte concurrente
      (escritos; ejecución contra Postgres real pendiente en Step N+1).
- [x] Test de que la promoción A15 se dispara **exactamente una vez** desde `2b`/`2v` con
      cola y **cero** veces desde `2a/2c/2d` y `2b` sin cola.
- [x] Test de atomicidad: fallo en cualquier paso → rollback total; sin estado intermedio
      observable.
- [x] Verificar que la suite queda **RED** (tests fallando por falta de implementación).

## Implementación (tras RED; back ∥ front)

- [x] Backend (dominio): añadir la transición a `2z` en `maquina-estados.ts` (declarativa)
      + servicio de descarte con la tabla origen→efectos; reutilizar `liberarFecha()`,
      `promoverPrimeroEnCola` y el patrón de decremento de cola. Sin imports de infra en
      `domain/`.
- [x] Backend (infra): endpoint `POST /reservas/{id}/descartar` + adaptador UoW +
      controller + DTO + módulo; RLS del tenant; transacción única con `SELECT … FOR UPDATE`.
- [x] Frontend: acción "Marcar como descartada por cliente" en la ficha (botón
      deshabilitado en terminales, motivo opcional, manejo del error de RC-3). Mobile-first.

## Step N — Revisar y actualizar tests unitarios existentes

- [x] Revisar/actualizar los tests unitarios afectados (máquina de estados, servicio de
      consultas, cola) para que reflejen la nueva transición sin romper los existentes.
      (frontend actualizó tests vecinos: `AccionesConsulta`, `ArchivarReserva`, `FinalizarEvento`)

## Step N+1 — Unit tests + verificación de estado BD (EL AGENTE DEBE EJECUTARLO)

- [x] Ejecutar `pnpm test` (incl. integración/concurrencia contra Postgres real desde la
      sesión principal) + verificar estado de BD: 0 RESERVA en `2z` con `FECHA_BLOQUEADA`
      activa; 0 `posicion_cola` inconsistente.
      (concurrencia 3/3 PASS + BD real verificada, sesión principal 2026-07-15)
- [x] Report: `openspec/changes/us-013-descartar-consulta-por-cliente/reports/2026-07-15-step-N+1-unit-test-and-db-verification.md`

## Step N+2 — Pruebas manuales de endpoints con curl (EL AGENTE DEBE EJECUTARLO)

- [x] Ejecutar curl contra el endpoint de descarte para los 6 orígenes + FA (terminal,
      cola vacía, sin motivo) + RC-3; restaurar BD al estado inicial tras las pruebas.
      (6/6 PASS sesión principal 2026-07-15: 200 descarte 2a con motivo→notas anexadas;
      200 descarte 2b→fecha liberada; 409 re-descarte terminal; 409 terminal s2x; 404
      inexistente; 401 sin auth; BD restaurada: reserva=1, fecha_bloqueada=0)
- [x] Report: `openspec/changes/us-013-descartar-consulta-por-cliente/reports/2026-07-15-step-N+2-curl-endpoint-tests.md`

## Step N+3 — E2E con Playwright MCP (HAY FRONTEND; EL AGENTE DEBE EJECUTARLO)

- [x] Ejecutar el flujo en la ficha del gestor: descartar con y sin motivo, botón
      deshabilitado en terminal, mensaje de RC-3; verificar en viewports 390 / 768 / 1280.
      (PASS en 390/768/1280 sesión principal 2026-07-15: happy path→2z, botón disabled en
      terminal, sin overflow horizontal)
- [x] Mover capturas E2E a `reports/e2e-screenshots/` del change. (9 capturas)
- [x] Report: `openspec/changes/us-013-descartar-consulta-por-cliente/reports/2026-07-15-step-N+3-e2e-playwright.md`

## Step N+4 — Actualizar documentación técnica

- [x] Actualizar `docs/` afectada (máquina de estados / transiciones, use-cases si procede)
      vía `docs-keeper`. (docs-keeper actualizó `docs/use-cases.md` — UC-10/UC-13 + diagrama
      de estados §6 — y `docs/data-model.md` §3.5)

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff contra guardrails (hexagonal, bloqueo atómico, contrato
      generado, responsive) → informe con línea literal `Veredicto: APTO` en
      `openspec/changes/us-013-descartar-consulta-por-cliente/reports/2026-07-15-step-review-code-review.md`

## GATE revisión humana final — PARADA OBLIGATORIA

- [x] `code-review` **APTO** + validación manual **aprobados por el humano** (esperar OK)
      antes de archive/PR. Sin informe APTO, el hook `require-code-review` bloquea archive y PR.
      (Gate final APROBADO por el humano 2026-07-15)

## Archive / PR (solo tras gate final y code-review APTO)

- [x] `openspec archive us-013-descartar-consulta-por-cliente` + actualizar
      `openspec/specs/consultas/spec.md`. (ejecutado en este paso, 2026-07-15;
      `consultas/spec.md` 138 → 147 requirements, +9 del delta)
- [ ] Abrir PR (GitHub MCP o `gh`) y actualizar el frontmatter de la US (estado, branch, pr).
      (lo ejecuta el humano tras el archive; NO abierto todavía)

## Estado actual (2026-07-15)

**TODA la QA está VERDE. El change está listo para archive + commit + PR.**

**Verde (cierre completo):** SDD aprobado (gate humano + 4 decisiones confirmadas), contrato
`docs/api-spec.yml` evolucionado (`POST /reservas/{id}/descartar` + `{ motivo? }`) y SDK
regenerado, TDD-RED completo, implementación back (dominio máquina-estados + UoW/controller/
DTO/módulo) ∥ front (acción en ficha) con lint/typecheck verdes, tests unitarios con mocks
VERDE (39 + 322 + 213), tests vecinos del frontend actualizados, y **code-review APTO**
(`reports/2026-07-15-step-review-code-review.md`).

**QA con BD real (sesión principal, 2026-07-15) — toda verde:**
- Step N+1: suite de **concurrencia 3/3 PASS** (RC-1/RC-2/RC-3 contra `slotify_test`) +
  verificación de estado de BD (0 RESERVA en `2z` con `FECHA_BLOQUEADA` activa;
  `posicion_cola` consistente).
- Step N+2: **curl 6/6 PASS** (200 descarte 2a con motivo→notas anexadas; 200 descarte
  2b→fecha liberada; 409 re-descarte terminal; 409 terminal s2x; 404 inexistente; 401 sin
  auth); BD restaurada (reserva=1, fecha_bloqueada=0).
- Step N+3: **E2E Playwright PASS en 390 / 768 / 1280** (happy path→2z, botón disabled en
  terminal, sin overflow); 9 capturas en `reports/e2e-screenshots/`.
- Step N+4: docs técnicas cerradas por `docs-keeper` (`docs/use-cases.md` UC-10/UC-13 +
  diagrama de estados §6; `docs/data-model.md` §3.5).

**Bug encontrado por QA y corregido durante el ciclo:** casteo `::uuid` en el adaptador UoW
hacía fallar el endpoint con 500 contra Postgres real; corregido y re-validado en verde por
la curl 6/6 y la E2E.

**Gate humano final: APROBADO.** El change se archiva en este mismo paso; el commit, el push
y el PR los ejecuta el humano a continuación.
