# Tasks — us-008-programar-visita-espacio

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/2026-06-30-us-008-programar-visita-espacio/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-008-programar-visita-espacio` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md` +
      `specs/comunicaciones/spec.md`) + `design.md` (decisiones D-1..D-9; **en especial
      D-2: insert-o-update del bloqueo `fase '2.v'` vs `modo: insert` del er-diagram;
      D-6: E6 post-commit; D-7: confirmar sin migración; D-8: A19/A20 en este change vs
      slice de jobs separado**) y **ESPERAR su OK explícito**
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir `POST /reservas/{id}/visita` (body `{ fecha, hora }`; respuestas 200
      `2v` + `visitaProgramadaFecha/Hora` + `visitaRealizada=false` + `ttlExpiracion`,
      409 cola `2d` (promover UC-12), 422 guarda de origen / `2.a` sin `fecha_evento` /
      fecha fuera de ventana, 404) según `design.md §D-5`
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente del hook
      `validate-openapi` si spectral no está instalado)
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de origen** en la máquina de estados: `2a/2b/2c → 2v`
      permitida; `2d` → rechazo con mensaje UC-12; terminales (`2x/2y/2z/cancelada/
      completada`) → rechazo (en rojo) — `maquina-estados-programar-visita.spec.ts`
      (guarda pura) + `programar-visita.use-case.spec.ts` y `…-integracion.spec.ts`
      (nivel aplicación: `2d → 409`, terminal → `422`)
- [x] 3.2 Test de la guarda `2.a` sin `fecha_evento` → bloqueo de la acción (en rojo) —
      `programar-visita.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.3 Test de la **ventana de fecha**: `fecha_visita ≤ hoy` → error futuro;
      `fecha_visita > hoy + max_dias_programar_visita` → error ventana; setting leído de
      `TENANT_SETTINGS`, nunca hardcodeado (en rojo) — `programar-visita.use-case.spec.ts`
      (incl. borde inclusivo hoy+N y lectura del setting) + `…-integracion.spec.ts`
- [x] 3.4 Test del use-case desde `2.b`/`2.c`: `→ 2v` + campos de visita +
      **UPDATE** del `ttl_expiracion` de la fila existente de `FECHA_BLOQUEADA` a
      `visita + 1 día (23:59:59)` + `AUDIT_LOG accion='transicion'`, en una sola
      transacción (en rojo) — `programar-visita.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.5 Test del use-case desde `2.a` sin bloqueo: `→ 2v` + **INSERT** de nueva fila
      `FECHA_BLOQUEADA` (`tipo_bloqueo='blando'`, TTL = visita +1 día) en la misma
      transacción (en rojo) — `programar-visita.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.6 Test de **atomicidad**: fallo parcial → rollback completo (RESERVA en su
      origen, sin campos de visita, sin `FECHA_BLOQUEADA` creada/actualizada) (en rojo) —
      `programar-visita.use-case.spec.ts` (propagación del error en RESERVA/FECHA_BLOQUEADA/AUDIT_LOG)
- [x] 3.7 **Tests de concurrencia REALES (skill `concurrency-locking`)**: transición a
      `2v` concurrente con el barrido A4 sobre la misma RESERVA → estado final coherente,
      sin estado intermedio; dos transiciones simultáneas a `2v` → exactamente una aplica,
      la otra recibe la guarda; INSERT desde `2.a` concurrente con otro bloqueo de la
      misma fecha → `UNIQUE(tenant_id,fecha)` serializa (en rojo) —
      `programar-visita-concurrencia.spec.ts` (`Promise.allSettled` + `SELECT … FOR UPDATE`)
- [x] 3.8 Test del **disparo de E6** y su registro en `COMUNICACION` (`codigo_email='E6'`,
      `estado='enviado'`, `reserva_id`, `cliente_id`), con transporte en modo fake; y que
      un fallo del proveedor no revierte la transición (E6 post-commit, D-6) (en rojo) —
      `programar-visita.use-case.spec.ts` (orden post-UoW + tolerancia a fallo) +
      `…-integracion.spec.ts` (fila E6 `enviado` en COMUNICACION)
- [x] 3.9 Confirmar que toda la batería está **en rojo** antes de implementar — 4 suites
      en RED por ausencia de implementación (`esOrigenValidoParaProgramarVisita` no
      exportado; módulo `application/programar-visita.use-case.ts` inexistente). Verificado
      con `npx jest --runInBand --testPathPatterns="programar-visita|maquina-estados-programar-visita"`

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-004/US-005/US-007/US-040/US-041/US-045 afectados por el
      reuso (`resolverPlanBloqueo`, máquina de estados declarativa, UoW de transición,
      mapper `2v`, motor de email) y ajustarlos sin romper su comportamiento; confirmar
      regresión cero en alta US-004, transición US-005/US-007, bloqueo US-040 y motor de
      email US-045

## 5. Implementación backend + frontend (post-gate — dueños: `backend-developer` / `frontend-developer`)
- [x] 5.1 Máquina de estados: añadir orígenes válidos `{2a,2b,2c} → 2v` + guardas (mensaje
      UC-12 para `2d`; `fecha_evento` para `2a`) declarativas (tabla, no `if` dispersos)
      (D-1)
- [x] 5.2 Refinar `resolverPlanBloqueo({fase:'2.v'})`: TTL = `visita + 1 día (23:59:59)`,
      `accion: insert|update` según origen (upsert por `UNIQUE(tenant_id,fecha)`) (D-2)
- [x] 5.3 Use-case de transición a `2v`: validar ventana de fecha + guardas; UPDATE de la
      RESERVA (`sub_estado`, `visita_programada_fecha/hora`, `visita_realizada=false`),
      INSERT-o-UPDATE de `FECHA_BLOQUEADA` con `SELECT … FOR UPDATE`, `AUDIT_LOG
      accion='transicion'`, todo en una única transacción (D-3/D-4)
- [x] 5.4 Disparo de **E6 post-commit** vía el motor de email de US-045 + registro en
      `COMUNICACION` (D-6)
- [x] 5.5 Mapper `sub-estado-consulta`: cablear `2v ↔ s2v` si aún no está; read-model
      `GET /reservas/{id}` expone `visitaProgramadaFecha/Hora` y `visitaRealizada`
- [x] 5.6 Endpoint `POST /reservas/{id}/visita` (controller + DTO `{fecha,hora}`) con
      mapeo de respuestas 200/409/422/404 (D-5); registrar en `reservas.module.ts`
- [x] 5.7 Frontend "ficha de consulta": acción "Programar visita" (deshabilitada/oculta en
      `2d`, terminales y `2a` sin `fecha_evento`) + formulario (selector de fecha limitado a
      `[mañana, hoy + N]` + hora) + confirmación + feedback (fecha de visita, nuevo TTL);
      responsive mobile-first (390/768/1280)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`, `comunicacion`,
      `audit_log`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (RESERVA en `2v` con campos de visita,
      `FECHA_BLOQUEADA` con TTL = visita +1 día creada o actualizada, `COMUNICACION` con E6,
      `AUDIT_LOG` con `transicion`) y restaurar si hace falta
- [x] 6.5 Crear report `reports/2026-06-30-step-6-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST `/reservas/{id}/visita` sobre RESERVA en `2b` con `fecha=hoy+3` → 200;
      verificar `2v`, campos de visita, `FECHA_BLOQUEADA` actualizada a visita +1 día, E6 en
      `COMUNICACION`, `AUDIT_LOG`. Restaurar BD
- [x] 7.3 POST sobre RESERVA en `2a` con `fecha_evento` definida y sin bloqueo → 200;
      verificar `2v`, nueva fila en `FECHA_BLOQUEADA` (`blando`, TTL visita +1 día), E6.
      Restaurar BD
- [x] 7.4 POST sobre RESERVA en `2c` → 200; verificar extensión del bloqueo y E6. Restaurar BD
- [x] 7.5 POST con `fecha ≤ hoy` → 422 (futuro) y `fecha > hoy + N` → 422 (ventana); RESERVA
      intacta
- [x] 7.6 POST sobre RESERVA en `2d` → 409 (promover UC-12); sobre `2a` sin `fecha_evento` →
      422; sobre terminal → 422; sin efectos
- [x] 7.7 POST sobre RESERVA inexistente/cross-tenant → 404; sin sesión → 401
- [x] 7.8 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.9 Crear report `reports/2026-06-30-step-7-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
> Ejecutado en sesión principal (Playwright MCP disponible). Destapó un bucle de
> render infinito sistémico (pre-existente US-005, replicado US-007/US-008) en los 3
> diálogos de la ficha; corregido en sesión (deps estables del `useEffect`). Detalle
> en `reports/2026-06-30-step-8-e2e-playwright.md`.
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar a la ficha de una consulta en `2b` (`browser_navigate`)
- [x] 8.3 Programar visita (fecha dentro de ventana + hora) + confirmar; verificar transición
      a `2v`, fecha/hora de visita y nuevo TTL en el feedback
- [x] 8.4 Verificar que el selector de fecha limita a `[mañana, hoy + N]` y rechaza fechas
      fuera de rango con mensaje
- [x] 8.5 Verificar que la acción está deshabilitada/oculta en `2d`, terminales y `2a` sin
      `fecha_evento`
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.7 Verificar persistencia (UI ↔ BD: `2v`, `FECHA_BLOQUEADA`, E6) y restaurar entorno/BD
- [x] 8.8 Crear report `reports/2026-06-30-step-8-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición
      `{2a,2b,2c}→2v`, bloqueo `fase '2.v'` insert-o-update, ventana
      `max_dias_programar_visita`, guardas de origen; capability `comunicaciones`: disparo de
      E6) y la trazabilidad de la US (`docs/use-cases.md` UC-07, `docs/er-diagram.md`
      §3.16/§RESERVA/§TENANT_SETTINGS, `docs/data-model.md`). Sin cambios en `api-spec.yml`
      salvo lo del `contract-engineer`; confirmar sin migración (D-7)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin bloqueo
      distribuido, sin editar cliente generado, responsive, atomicidad de la transición,
      reuso real de `resolverPlanBloqueo`/máquina declarativa/motor de email US-045, E6
      post-commit)
- [x] 10.2 Dejar informe `reports/2026-06-30-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive 2026-06-30-us-008-programar-visita-espacio` (solo tras gate
      final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
