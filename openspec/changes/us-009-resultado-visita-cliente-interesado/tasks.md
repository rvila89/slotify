# Tasks — us-009-resultado-visita-cliente-interesado

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-009-resultado-visita-cliente-interesado/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-009-resultado-visita-cliente-interesado` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md` +
      `specs/comunicaciones/spec.md`) + `design.md` (decisiones D-1..D-7; **en especial
      D-4: E7 post-commit; D-5: superficie de API — endpoint `POST /reservas/{id}/resultado-visita`
      vs evolucionar el stub `PATCH /reservas/{id}/visita`; D-6: confirmar sin migración
      (verificar plantilla E7); D-7: A20 en este change vs slice de jobs separado**) y
      **ESPERAR su OK explícito**
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [ ] 2.1 Evolucionar el contrato: definir el endpoint de resultado de visita "interesado"
      (opción A `POST /reservas/{id}/resultado-visita` body `{ resultado: "interesado" }`, u
      opción B evolucionar el stub `PATCH /reservas/{id}/visita` + `ResultadoVisitaRequest`);
      respuestas 200 (`2b` + `visitaRealizada=true` + `ttlExpiracion` fresco), 422 (guarda de
      origen: no en `2v` / terminal), 404, 401/403 — según `design.md §D-5`
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente del hook
      `validate-openapi` si spectral no está instalado)
- [ ] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [ ] 3.1 Test de la **guarda de origen** en la máquina de estados: `2v → 2b` permitida;
      todo otro origen (`2a/2b/2c/2d`) → rechazo; terminales (`2x/2y/2z/cancelada/completada`)
      → rechazo (en rojo) — `maquina-estados-resultado-visita.spec.ts` (guarda pura) +
      `resultado-visita-interesado.use-case.spec.ts` y `…-integracion.spec.ts` (nivel
      aplicación: no en `2v` → 422)
- [ ] 3.2 Test del use-case desde `2.v`: `→ 2b` + `visita_realizada=true` +
      `ttl_expiracion = now + ttl_consulta_dias` (fresco, leído de `TENANT_SETTINGS`, **no**
      acumulado ni derivado de `visita_programada_fecha`) + **UPDATE** del `ttl_expiracion` de
      la fila existente de `FECHA_BLOQUEADA` al mismo valor (`tipo_bloqueo` permanece `blando`)
      + `AUDIT_LOG accion='transicion'` (datos antes/después), todo en una sola transacción
      (en rojo) — `resultado-visita-interesado.use-case.spec.ts` + `…-integracion.spec.ts`
- [ ] 3.3 Test del **TTL fresco**: con `ttl_expiracion` previo = día post-visita y
      `visita_programada_fecha` futura, el nuevo TTL = `now + ttl_consulta_dias` (independiente
      de ambos); setting leído de `TENANT_SETTINGS`, nunca hardcodeado (en rojo)
- [ ] 3.4 Test del **registro antes de la fecha de visita** (FA): `visita_programada_fecha > hoy`
      NO bloquea el registro; la transición procede y el TTL se calcula desde `now` (en rojo)
- [ ] 3.5 Test de **atomicidad**: fallo parcial → rollback completo (RESERVA en `2v`,
      `visita_realizada=false`, TTL previo intacto, `FECHA_BLOQUEADA` sin modificar) (en rojo) —
      `resultado-visita-interesado.use-case.spec.ts` (propagación del error en
      RESERVA/FECHA_BLOQUEADA/AUDIT_LOG)
- [ ] 3.6 **Tests de concurrencia REALES (skill `concurrency-locking`)**: registro de
      "interesado" concurrente con el barrido A21/US-012 sobre la misma RESERVA →
      **commit-first**, estado final coherente, sin estado intermedio (`2b` sin
      `FECHA_BLOQUEADA` actualizada); dos registros simultáneos → exactamente uno aplica, el
      otro recibe la guarda (en rojo) — `resultado-visita-interesado-concurrencia.spec.ts`
      (`Promise.allSettled` + `SELECT … FOR UPDATE`)
- [ ] 3.7 Test del **disparo de E7** y su registro en `COMUNICACION` (`codigo_email='E7'`,
      `estado='enviado'`, `reserva_id`, `cliente_id`), con transporte en modo fake; y que un
      fallo del proveedor no revierte la transición y queda `estado='fallido'` (E7 post-commit,
      D-4) (en rojo) — `resultado-visita-interesado.use-case.spec.ts` (orden post-UoW +
      tolerancia a fallo) + `…-integracion.spec.ts` (fila E7 en COMUNICACION)
- [ ] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar (verificado con
      `npx jest --runInBand --testPathPatterns="resultado-visita|maquina-estados-resultado-visita"`)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [ ] 4.1 Revisar tests de US-004/US-005/US-006/US-007/US-008/US-040/US-045 afectados por el
      reuso (`resolverPlanBloqueo` fase `2.b`, máquina de estados declarativa, UoW de
      transición, mapper `2v/2b`, motor de email) y ajustarlos sin romper su comportamiento;
      confirmar regresión cero en alta US-004, transiciones US-005/007/008, prórroga US-006,
      bloqueo US-040 y motor de email US-045

## 5. Implementación backend + frontend (post-gate — dueños: `backend-developer` / `frontend-developer`)
- [ ] 5.1 Máquina de estados: añadir origen válido `{2v} → 2b` (resultado "interesado")
      + guarda declarativa (tabla, no `if` dispersos): todo origen distinto de `2v` inválido,
      terminales inmutables (D-1)
- [ ] 5.2 Reutilizar `resolverPlanBloqueo({fase:'2.b'})`: TTL = `now + ttl_consulta_dias`
      (fresco); modo efectivo **UPDATE** sobre la fila bloqueante existente (la fila siempre
      existe al venir de `2v`); `tipo_bloqueo` permanece `blando` (D-2)
- [ ] 5.3 Use-case `2v → 2b` "cliente interesado": validar guarda de origen; UPDATE de la
      RESERVA (`sub_estado='2b'`, `visita_realizada=true`, `ttl_expiracion = now +
      ttl_consulta_dias`), UPDATE de `FECHA_BLOQUEADA` al mismo TTL con `SELECT … FOR UPDATE`,
      `AUDIT_LOG accion='transicion'` (datos antes/después), todo en una única transacción
      (D-3)
- [ ] 5.4 Disparo de **E7 post-commit** vía el motor de email de US-045 + registro en
      `COMUNICACION` (`enviado`/`fallido`) (D-4)
- [ ] 5.5 Read-model `GET /reservas/{id}` expone `subEstado`, `visitaRealizada` y
      `ttlExpiracion` actualizados (reuso de `obtener-reserva.query.ts`); mapper `2v/2b`
      cableado (ya desde US-008)
- [ ] 5.6 Endpoint de resultado de visita (controller + DTO `{resultado}`) con mapeo de
      respuestas 200/422/404 (D-5); registrar en `reservas.module.ts`
- [ ] 5.7 Frontend "ficha de reserva": acción "Registrar resultado de visita" → opción
      "Cliente interesado" (visible solo en `2v`) + confirmación + feedback (nuevo sub-estado
      `2b`, nuevo TTL del bloqueo); responsive mobile-first (390/768/1280)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`, `comunicacion`,
      `audit_log`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (RESERVA en `2b` con `visita_realizada=true` y TTL
      fresco, `FECHA_BLOQUEADA` con `ttl_expiracion` actualizado y `tipo_bloqueo='blando'`,
      `COMUNICACION` con E7, `AUDIT_LOG` con `transicion`) y restaurar si hace falta
- [x] 6.5 Crear report
      `reports/2026-07-03-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST resultado "interesado" sobre RESERVA en `2v` → 200; verificar `2b`,
      `visitaRealizada=true`, `ttlExpiracion` fresco (`now + ttl_consulta_dias`),
      `FECHA_BLOQUEADA` actualizada al mismo TTL (`blando`), E7 en `COMUNICACION`,
      `AUDIT_LOG accion='transicion'`. Restaurar BD
- [x] 7.3 POST sobre RESERVA en `2v` con `visita_programada_fecha` futura → 200 (el registro no
      depende de que la visita haya llegado); TTL desde `now`. Restaurar BD
- [x] 7.4 POST sobre RESERVA en `2a`/`2b`/`2c`/`2d` (no en `2v`) → 422 (guarda de origen);
      RESERVA intacta
- [ ] 7.5 POST sobre RESERVA en terminal (`2x`/`2y`/`2z`/`cancelada`/`completada`) → 422; sin
      efectos
- [x] 7.6 POST sobre RESERVA inexistente/cross-tenant → 404; sin sesión → 401
- [x] 7.7 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.8 Crear report `reports/2026-07-03-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar a la ficha de una consulta en `2v` (`browser_navigate`)
- [x] 8.3 "Registrar resultado de visita" → "Cliente interesado" + confirmar; verificar
      transición a `2b`, `visitaRealizada=true` y nuevo TTL en el feedback
- [x] 8.4 Verificar que la opción "Cliente interesado" está visible **solo** en `2v` (oculta/
      deshabilitada en otros sub-estados y terminales)
- [x] 8.5 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.6 Verificar persistencia (UI ↔ BD: `2b`, `visita_realizada=true`, `FECHA_BLOQUEADA` con
      TTL fresco, E7) y restaurar entorno/BD
- [x] 8.7 Crear report `reports/2026-07-03-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición `2v → 2b`,
      TTL fresco `now + ttl_consulta_dias`, UPDATE de `FECHA_BLOQUEADA`, guarda de origen
      mono-estado; capability `comunicaciones`: disparo de E7) y la trazabilidad de la US
      (`docs/use-cases.md` UC-08, `docs/er-diagram.md` §3.6/§RESERVA/§TENANT_SETTINGS,
      `docs/data-model.md`, `docs/architecture.md` §motor E7). Sin cambios en `api-spec.yml`
      salvo lo del `contract-engineer`; confirmar sin migración (D-6)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin bloqueo
      distribuido, sin editar cliente generado, responsive, atomicidad de la transición,
      commit-first vs barrido A21, reuso real de `resolverPlanBloqueo`/máquina declarativa/
      motor de email US-045, E7 post-commit, TTL fresco leído del setting)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-009-resultado-visita-cliente-interesado` (solo tras gate final
      y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
