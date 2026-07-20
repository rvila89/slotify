# Tasks: cambiar-fecha-consulta-en-cola

> Pasos obligatorios de `openspec/config.yaml` en orden. El AGENTE ejecuta cada
> prueba y verifica antes de marcar `[x]`. Nunca se delega testing al usuario.

## Step 0 — Crear feature branch (PRIMERO)

- [x] Crear y cambiar a `feature/cambiar-fecha-consulta-en-cola` desde `master`
      (worktree ya creado en esa rama).

## GATE — Revisión humana SDD (⏸ PARADA OBLIGATORIA)

- [x] `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md` **aprobados
      por el humano** (esperar OK explícito). El flujo se DETIENE aquí: no se
      implementa nada ni se toca contrato/tests hasta el OK.

## TDD primero (tests en RED antes de implementar)

- [x] Test de dominio: `esOrigenCambiarFechaEnCola` acepta `consulta/2d` y rechaza el
      resto; `esOrigenValidoParaCambiarFecha` sigue **sin** aceptar `2d`.
- [x] Test de máquina de estados: transición `2d → 2b` en cambio de fecha (rama cola);
      orígenes no válidos → 422.
- [x] Test de aplicación (`CambiarFechaUseCase` rama `2d`, fecha libre): INSERT bloqueo
      blando de F2 + `fecha_evento=F2` + `sub_estado 2d→2b` + `posicion_cola→NULL` +
      `consulta_bloqueante_id→NULL` + `ttl_expiracion` fijado + reordenación de cola
      vieja + borrador E1 `'disponible'` + AUDIT_LOG; **sin** promoción.
- [x] Test de aplicación (rama `2d`, fecha ocupada): `CambiarFechaConflictoError` (409)
      terminal, shape solo `motivo` (sin `colaDisponible`), rollback total (cola intacta).
- [x] Test de reordenación de cola: descarte-por-cambio de posición intermedia cierra el
      hueco contiguo desde 1; bloqueante intacto; ninguna `FECHA_BLOQUEADA` liberada.
- [x] Test de concurrencia: dos `2d` cambiando a la **misma** `F2` libre → solo una
      bloquea (UNIQUE tenant_id,fecha), la otra 409 sin efectos.
- [x] Confirmar que TODOS los tests nuevos están en **RED** antes de implementar.

## Step N — Implementación (revisar/actualizar tests unitarios existentes)

### Contrato (solo documental)
- [x] Actualizar `docs/api-spec.yml` (documentar `2d` como origen admitido de
      `POST /reservas/{id}/cambiar-fecha`; **sin** cambios de esquema request/response).
      Validar con `spectral lint docs/api-spec.yml`. **No** regenerar SDK si el esquema
      no cambia.

### Backend `apps/api/src/reservas`
- [x] Dominio `maquina-estados.ts`: `ORIGENES_CAMBIAR_FECHA_EN_COLA` +
      `esOrigenCambiarFechaEnCola` (guarda **separada**); seam de salida de cola con
      reordenación (reutiliza mecánica US-013).
- [x] Application `cambiar-fecha.use-case.ts`: rama `2d` seleccionada por el origen;
      INSERT bloqueo blando F2 (`bloquearEnTx`/`resolverPlanBloqueo` fase `2.b`),
      `sub_estado 2d→2b`, salida+reordenación de cola vieja, **sin** promoción; crear
      borrador E1 (`plantilla-transicion-fecha.ts` rama `'disponible'`) en la misma tx.
- [x] Infra (UoW/repositorio adapter): operaciones de INSERT bloqueo + UPDATE reserva +
      reordenación de cola + INSERT COMUNICACION borrador, todo en UNA `$transaction`
      con RLS.
- [x] Controller: mapear guarda de origen inválido → **422**; conflicto fecha ocupada →
      **409** (shape solo `motivo`).
- [x] Revisar/actualizar tests unitarios existentes de `cambiar-fecha` (2b/2c/2v) para
      confirmar que la rama existente **no cambia** de comportamiento.

### Frontend `apps/web/src/features/reservas`
- [x] Habilitar el botón *"Cambiar fecha"* en el detalle para `sub_estado='2d'` (hoy
      deshabilitado con motivo); mantener responsive (390/768/1280) y arrow functions.
- [x] Actualizar/añadir tests de UI del detalle para el estado `2d`.

## Step N+1 — Unit tests + verificación de estado BD (AGENTE EJECUTA) + report

- [x] Ejecutar `pnpm test` (backend + frontend) y verificar VERDE (incluida
      concurrencia y máquina de estados).
- [x] Verificar estado BD tras los casos: bloqueo de F2, `sub_estado`, `posicion_cola`
      contigua, `consulta_bloqueante_id`, COMUNICACION borrador, AUDIT_LOG.
- [x] Report en `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.

## Step N+2 — Pruebas manuales con curl (AGENTE EJECUTA, restaurar BD) + report

- [x] `POST /reservas/{id}/cambiar-fecha` sobre una `2d` a fecha libre → `2b` + borrador
      E1 + cola reordenada.
- [x] Mismo endpoint sobre una `2d` a fecha ocupada → **409** terminal (solo `motivo`),
      cola intacta.
- [x] Origen inválido → **422**. Restaurar BD tras las pruebas.
- [x] Report en `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`.

## Step N+3 — E2E con Playwright MCP (hay frontend) (AGENTE EJECUTA) + report

- [x] Flujo desde el detalle: consulta en `2d` → *"Cambiar fecha"* a fecha libre → pasa
      a `2b`, borrador E1 visible en el flujo US-046, en 3 viewports (390/768/1280).
- [x] Caso fecha ocupada → mensaje de conflicto sin re-encolar.
- [x] Mover capturas a `reports/e2e-screenshots/`. Report en
      `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`.

## Step N+4 — Actualizar documentación técnica

- [x] Actualizar `docs/` afectada (máquina de estados / casos de uso) para reflejar `2d`
      como origen de cambio de fecha.

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff contra guardrails (hexagonal, bloqueo atómico, RLS,
      responsive, arrow functions) → report con **`Veredicto: APTO`** en
      `reports/YYYY-MM-DD-step-review-code-review.md`.

## GATE — Revisión humana final (⏸ PARADA OBLIGATORIA)

- [x] code-review **APTO** + validación manual **aprobados por el humano** (esperar OK)
      antes de archive/PR.

## Archive

- [x] `openspec archive cambiar-fecha-consulta-en-cola`; actualizar
      `openspec/specs/consultas/`; abrir PR (solo tras gate final y code-review APTO).
