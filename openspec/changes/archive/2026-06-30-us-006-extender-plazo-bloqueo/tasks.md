# Tasks — us-006-extender-plazo-bloqueo

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-006-extender-plazo-bloqueo/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-006-extender-plazo-bloqueo` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` (decisiones D-1..D-9; **en especial D-1: guarda multi-estado de
      bloqueo activo extensible; y D-3: códigos HTTP 409 vs 422 de los edge cases**) y
      **ESPERAR su OK explícito**
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir `POST /reservas/{id}/extender-bloqueo` (body `{ dias: integer ≥ 1 }`;
      respuestas 200 `ttlExpiracion` nuevo + estado/subEstado sin cambios, 409 bloqueo
      expirado / sin fecha bloqueada / firme, 422 estado sin bloqueo extensible o
      `dias` inválido, 404) según `design.md §D-6`
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente vía
      `validate-openapi` si spectral no está instalado)
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de precondición declarativa** (`2b/2c/2v` +
      `pre_reserva` extensibles; `2a`/terminales/`reserva_confirmada` rechazados) (en
      rojo) → `__tests__/maquina-estados-extender-bloqueo.spec.ts`
- [x] 3.2 Test del use-case happy path: RESERVA con bloqueo blando vigente →
      `ttl_expiracion = ttl_actual + N días` en RESERVA **y** `FECHA_BLOQUEADA`, sin
      cambiar estado/sub_estado/tipo_bloqueo/fecha + `AUDIT_LOG accion='actualizar'`
      con `datos_anteriores/nuevos.ttl_expiracion`, en una sola transacción (en rojo) →
      `__tests__/extender-bloqueo.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.3 Test de **invariancia** (D-8): tras la extensión, `estado`, `sub_estado`,
      `tipo_bloqueo` y `fecha` son idénticos a los previos (en rojo) →
      `__tests__/extender-bloqueo.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.4 Test de **atomicidad**: fallo parcial → rollback completo (TTL de RESERVA y
      `FECHA_BLOQUEADA` sin extender, sin entrada en `AUDIT_LOG`) (en rojo) →
      `__tests__/extender-bloqueo.use-case.spec.ts`
- [x] 3.5 **Tests de concurrencia REALES (skill `concurrency-locking`)**: extensión en
      el límite del vencimiento concurrente con una expiración simulada del barrido
      (US-012) sobre la misma fila bloqueante → estado final coherente (extensión
      aplicada y bloqueo vigente, **o** bloqueo expirado y extensión rechazada), sin
      estados intermedios; dos extensiones simultáneas → serialización determinista sin
      lost-update (en rojo) → `__tests__/extender-bloqueo-concurrencia.spec.ts`
- [x] 3.6 Test de edge case **TTL expirado**: `ttl_expiracion < ahora` → rechazo;
      RESERVA y `FECHA_BLOQUEADA` intactas (en rojo) → `…use-case.spec.ts` +
      `…-integracion.spec.ts`
- [x] 3.7 Test de edge case **estado sin bloqueo activo**: `2a`/terminal → rechazo;
      `reserva_confirmada` (firme, sin TTL) → rechazo; sin mutación (en rojo) →
      `…use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.8 Test de edge case **valor inválido**: `dias` 0/negativo/no entero → error de
      validación, sin mutación (en rojo) → `__tests__/extender-bloqueo.use-case.spec.ts`
- [x] 3.9 Confirmar que toda la batería está **en rojo** antes de implementar
      (verificado: 4 suites RED — guarda/use-case/integración/concurrencia; el
      `…controller.spec.ts` queda en verde por ser glue HTTP con el use-case mockeado)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-004/US-005/US-007/US-008/US-040/US-041 afectados por el
      reuso (UoW de transición con `SELECT … FOR UPDATE`, predicado declarativo de
      estados, adaptador de `FECHA_BLOQUEADA`) y ajustarlos sin romper su
      comportamiento; confirmar regresión cero de altas y transiciones previas y del
      bloqueo público de US-040

## 5. Implementación backend + frontend (post-gate — dueño: `backend-developer` / `frontend-developer`)
- [x] 5.1 Máquina de estados: añadir el **predicado declarativo**
      `esEstadoConBloqueoBlandoExtensible(estado, subEstado)` (tabla de datos, no `if`
      dispersos) (D-1)
- [x] 5.2 Use-case `extender-bloqueo`: validar guarda + fila blanda vigente
      (`ttl_expiracion > ahora`), validar `dias` entero ≥ 1, calcular `nuevoTtl =
      ttl_actual + dias`, y en una única transacción con `SELECT … FOR UPDATE` sobre la
      fila bloqueante: UPDATE `RESERVA.ttl_expiracion`, UPDATE
      `FECHA_BLOQUEADA.ttl_expiracion`, INSERT `AUDIT_LOG accion='actualizar'` (D-4/D-8);
      sin tocar estado/sub_estado/tipo_bloqueo/fecha
- [x] 5.3 Endpoint `POST /reservas/{id}/extender-bloqueo` (controller + DTO con `dias`)
      con mapeo de respuestas 200/409/422/404 (D-2/D-3/D-6); registrar en
      `reservas.module.ts`
- [x] 5.4 Frontend "ficha de consulta/pre-reserva": acción "Extender bloqueo"
      (visible/habilitada solo con bloqueo activo en `2b/2c/2v/pre_reserva` y TTL
      vigente) + input de N días (validación entero ≥ 1) + confirmación + feedback del
      nuevo `ttlExpiracion`; responsive mobile-first (390/768/1280)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts/valores de `reserva.ttl_expiracion`,
      `fecha_bloqueada.ttl_expiracion`, `audit_log`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (TTL extendido N días en RESERVA **y**
      `FECHA_BLOQUEADA`; estado/sub_estado/tipo_bloqueo/fecha sin cambios; `AUDIT_LOG`
      `actualizar` con valores anterior/nuevo) y restaurar si hace falta
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST `/reservas/{id}/extender-bloqueo` con `{ dias: N }` sobre RESERVA en
      `2b` con TTL vigente → 200; verificar TTL extendido en RESERVA y `FECHA_BLOQUEADA`,
      estado/sub_estado sin cambios, `AUDIT_LOG actualizar`. Restaurar BD
- [x] 7.3 Repetir en `2c`, `2v` y `pre_reserva` → 200; mismas verificaciones. Restaurar BD
- [x] 7.4 POST con `ttl_expiracion < ahora` → 409 (bloqueo expirado); sin
      `FECHA_BLOQUEADA` activa → 409; `reserva_confirmada` (firme) → 409; RESERVA
      intacta. Restaurar BD
- [x] 7.5 POST sobre estado sin bloqueo extensible (`2a`/terminal) → 422 sin efectos
- [x] 7.6 POST con `dias` 0/negativo/no entero → 422 (validación) sin efectos
- [x] 7.7 POST sobre RESERVA inexistente/cross-tenant → 404; sin sesión → 401
- [x] 7.8 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.9 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar a la ficha de una consulta con bloqueo activo (`browser_navigate`)
- [x] 8.3 Extender bloqueo (introducir N días + confirmar); verificar el nuevo TTL y el
      feedback en la UI
- [x] 8.4 Verificar que la acción está oculta/deshabilitada cuando no hay bloqueo activo
      (`2a`/terminal/`reserva_confirmada`) o el TTL ya expiró
- [x] 8.5 Verificar la validación del input (0/negativo/no entero → error en formulario)
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 8.8 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: extensión manual
      del TTL, predicado declarativo de bloqueo extensible, reprogramación implícita de
      A3/A4/A5 vía barrido, auditoría `actualizar`, concurrencia con el barrido) y la
      trazabilidad de la US (`docs/use-cases.md` UC-05, `docs/er-diagram.md` §3.5/§3.6,
      `docs/architecture.md §2.4`). Sin cambios en `api-spec.yml`
      salvo lo del `contract-engineer`; sin migración

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin
      bloqueo distribuido, sin editar cliente generado, responsive, atomicidad de las 3
      operaciones, invariancia de estado/tipo/fecha, reuso real de la UoW y del
      predicado declarativo, serialización frente al barrido)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 12.1 `openspec archive us-006-extender-plazo-bloqueo` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [x] 12.2 Actualizar `openspec/specs/` y abrir PR
