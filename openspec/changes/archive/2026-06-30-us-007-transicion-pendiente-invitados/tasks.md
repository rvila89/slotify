# Tasks — us-007-transicion-pendiente-invitados

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/2026-06-30-us-007-transicion-pendiente-invitados/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-007-transicion-pendiente-invitados` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` (decisiones D-1..D-8; **en especial D-1: origen `2.b` estricto vs
      admitir `2.a`-con-bloqueo; y D-7: email de invitados UC-06 p7 sin E-code, gap a
      confirmar con el PO**) y **ESPERAR su OK explícito**
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir `POST /reservas/{id}/pendiente-invitados` (body vacío; respuestas
      200 `2c` + `ttlExpiracion` + `consultasDescartadas?`, 409 bloqueo expirado/sin
      fecha bloqueada, 422 guarda de origen, 404) según `design.md §D-6`
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (spectral no instalado en el
      entorno; validado vía openapi-typescript parse + verificación estructural de
      `$ref`s y la validación del hook `validate-openapi`)
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de origen `2.b`** en la máquina de estados: solo
      `2b→2c` permitida; `2a/2c/2v/terminales` → rechazo (en rojo)
- [x] 3.2 Test del use-case con cola vacía: RESERVA `2b→2c` + `ttl_expiracion =
      ttl_actual + ttl_consulta_dias` en RESERVA **y** `FECHA_BLOQUEADA` +
      `AUDIT_LOG accion='transicion'`, en una sola transacción (en rojo)
- [x] 3.3 Test del use-case con cola activa (A16): N RESERVA en `2d` apuntando a la
      bloqueante → `2y` + `posicion_cola=NULL` + `consulta_bloqueante_id=NULL`, en la
      misma transacción; auditoría por cada descartada (en rojo)
- [x] 3.4 Test de **atomicidad**: fallo parcial → rollback completo (RESERVA en `2b`,
      TTL sin extender, cola intacta en `2d`) (en rojo)
- [x] 3.5 **Tests de concurrencia REALES (skill `concurrency-locking`)**: transición a
      `2c` concurrente con operación de cola sobre la misma fecha → estado final
      coherente, 0 consultas en `2d` apuntando a la bloqueante, sin estados
      intermedios; dos transiciones simultáneas a `2c` → exactamente una aplica, la
      otra recibe la guarda (en rojo)
- [x] 3.6 Test de precondición de bloqueo: sin fila activa en `FECHA_BLOQUEADA` → 409;
      `ttl_expiracion < ahora` → 409 (bloqueo expirado); RESERVA intacta (en rojo)
- [x] 3.7 Test de que **no** se dispara ningún email fuera de §9.3 (E1–E8) en la
      transición (gap de spec del email de invitados, D-7) (en rojo)
- [x] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-004/US-005/US-040/US-041 afectados por el reuso
      (`resolverPlanBloqueo`, máquina de estados declarativa, UoW de transición,
      mapper `2c/2y`) y ajustarlos sin romper su comportamiento; confirmar regresión
      cero del alta US-004, de la transición US-005 y del bloqueo público de US-040

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados: añadir transición permitida `2b→2c` + guarda de origen
      `2.b` declarativa (tabla, no `if` dispersos) (D-3)
- [x] 5.2 Use-case de transición `2.b → 2.c`: UPDATE de la RESERVA existente
      (sub_estado + TTL extendido vía `resolverPlanBloqueo({fase:'2.c'})`), UPDATE del
      `ttl_expiracion` de `FECHA_BLOQUEADA` con `SELECT … FOR UPDATE`, vaciado de cola
      `2d→2y` masivo, `AUDIT_LOG accion='transicion'` de principal + descartadas, todo
      en una única transacción (D-4/D-5)
- [x] 5.3 Mapper `sub-estado-consulta`: cablear `2c/2y ↔ s2c/s2y` si aún no está
- [x] 5.4 Endpoint `POST /reservas/{id}/pendiente-invitados` (controller + DTO) con
      mapeo de respuestas 200/409/422/404 (D-2/D-6); registrar en `reservas.module.ts`
- [x] 5.5 Frontend "ficha de consulta 2.b": acción "Marcar como pendiente de
      invitados" (habilitada solo con bloqueo activo) + confirmación + feedback (nuevo
      TTL, recuento de consultas de cola descartadas); responsive mobile-first
      (390/768/1280)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`,
      `comunicacion`, `audit_log`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (RESERVA en `2c`, TTL extendido en RESERVA
      y `FECHA_BLOQUEADA`, 0 consultas en `2d` apuntando a la bloqueante, descartadas
      en `2y` con campos de cola en NULL) y restaurar si hace falta
- [x] 6.5 Crear report `reports/2026-06-30-step-6-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST `/reservas/{id}/pendiente-invitados` sobre RESERVA en `2b` sin cola →
      200; verificar `2c`, TTL extendido en RESERVA y `FECHA_BLOQUEADA`, AUDIT_LOG
      `transicion`. Restaurar BD
- [x] 7.3 POST sobre RESERVA en `2b` con cola activa (N en `2d`) → 200; verificar
      todas pasan a `2y` con `posicion_cola`/`consulta_bloqueante_id` en NULL, TTL
      extendido, auditoría por cada descartada. Restaurar BD
- [x] 7.4 POST sobre RESERVA en `2b` con `ttl_expiracion < ahora` → 409 (bloqueo
      expirado), y sobre RESERVA sin `FECHA_BLOQUEADA` → 409; RESERVA intacta.
      Restaurar BD
- [x] 7.5 POST sobre RESERVA que no está en `2b` (guarda: `2a`/`2c`/terminal) → 422
      sin efectos
- [x] 7.6 POST sobre RESERVA inexistente/cross-tenant → 404; sin sesión → 401
- [x] 7.7 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.8 Crear report `reports/2026-06-30-step-7-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar a la ficha de una consulta en `2b` (`browser_navigate`)
- [x] 8.3 Marcar como pendiente de invitados + confirmar; verificar transición a `2c`,
      nuevo TTL y feedback de consultas de cola descartadas
- [x] 8.4 Verificar que la acción está deshabilitada/oculta cuando no hay bloqueo
      activo o la RESERVA no está en `2b`
- [x] 8.5 Verificar el caso con cola activa: el feedback refleja el recuento de
      consultas descartadas
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 8.8 Crear report `reports/2026-06-30-step-8-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición
      `2b→2c`, extensión `fase '2.c'` del bloqueo, vaciado de cola A16, guarda de
      origen `2.b`, precondición de bloqueo vigente, endpoint de transición) y la
      trazabilidad de la US (`docs/use-cases.md` UC-06, `docs/er-diagram.md` §3.16/§7.3,
      `docs/data-model.md`). Sin cambios en `api-spec.yml` salvo lo del
      `contract-engineer`; sin migración

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin
      bloqueo distribuido, sin editar cliente generado, responsive, atomicidad de las
      4 operaciones, reuso real de `resolverPlanBloqueo`/máquina declarativa)
- [x] 10.2 Dejar informe `reports/2026-06-30-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación); addendum tras 3
      fixes menores, también con `Veredicto: APTO`

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR (OK humano recibido: COMMIT + ARCHIVE + PR)

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive 2026-06-30-us-007-transicion-pendiente-invitados` (solo
      tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin
      APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
