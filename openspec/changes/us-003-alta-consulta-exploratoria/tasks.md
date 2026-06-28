# Tasks — us-003-alta-consulta-exploratoria

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar
> él mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada
> `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-003-alta-consulta-exploratoria/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-003-alta-consulta-exploratoria` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`)
      + `design.md` (las 4 decisiones) y **ESPERAR su OK explícito**
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Evolucionar `POST /reservas` / `CreateReservaRequest`: añadir `comentarios`
      (decide E1 enviado vs borrador); fijar requireds de contacto en
      `CreateClienteRequest` y el cuerpo de error de validación
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **entrada inicial de la máquina de estados**: creación →
      `consulta`/`2a` con `ttl_expiracion = NULL` (en rojo)
- [x] 3.2 Test del use-case de alta: crea RESERVA + CLIENTE + COMUNICACION +
      AUDIT_LOG en una transacción; **no** crea `FECHA_BLOQUEADA`
- [x] 3.3 Test de E1: sin `comentarios` → COMUNICACION `estado='enviado'` + puerto
      de email invocado; con `comentarios` → `estado='borrador'` + puerto NO invocado
- [x] 3.4 Test de idempotencia de CLIENTE por `(tenant_id, email)` (find-or-create)
- [x] 3.5 Test de AUDIT_LOG: `accion='crear'`, `entidad='RESERVA'`, `datos_nuevos`
- [x] 3.6 Tests de validación: obligatorios incompletos / email inválido /
      `canal_entrada` fuera del ENUM → no crea NADA
- [x] 3.7 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar tests de `reservas`/`clientes`/`comunicaciones` afectados y
      ajustarlos a la nueva lógica de alta (revisados: cambios aditivos; los smoke
      specs de módulo siguen en verde, ningún test existente requirió ajuste)

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 `EnviarEmailPort` (dominio) + adaptador **stub** en `comunicaciones`
      (sin red; US-045 enchufará el real) — `design.md §1`
- [x] 5.2 Estructura declarativa mínima de máquina de estados (entrada inicial) —
      `design.md §3`
- [x] 5.3 Use-case de alta de consulta + find-or-create de CLIENTE +
      persistencia de COMUNICACION + AUDIT_LOG, todo en `$transaction` con
      `fijarTenant` — `design.md §2, §4`
- [x] 5.4 Helper de mapeo dominio `'2a'` ↔ Prisma `s2a`
- [x] 5.5 Controller del alta cableado al contrato; sin migración de schema
- [x] 5.6 Frontend "Nueva consulta": formulario (TanStack Form + SDK), validación
      por campo, alerta de borrador E1 pendiente

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `cliente`, `comunicacion`,
      `audit_log`, `fecha_bloqueada`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (incl. que NO se creó `fecha_bloqueada`)
      y restaurar si hace falta
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST alta SIN comentarios → 201; verificar RESERVA `consulta`/`2a`,
      `ttl_expiracion=NULL`, COMUNICACION `E1`/`enviado`, AUDIT_LOG `crear`/`RESERVA`,
      y que NO hay `fecha_bloqueada`. Restaurar BD
- [x] 7.3 POST alta CON comentarios → 201; verificar COMUNICACION `E1`/`borrador`
      sin envío. Restaurar BD
- [x] 7.4 POST con el mismo email del tenant → verificar reutilización de CLIENTE.
      Restaurar BD
- [x] 7.5 POST con obligatorios incompletos / email inválido / `canal_entrada`
      fuera del ENUM → error de validación y **ningún** registro creado
- [x] 7.6 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.7 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar al formulario "Nueva consulta" (`browser_navigate`)
- [x] 8.3 Flujo feliz sin comentarios: rellenar y confirmar; verificar creación
- [x] 8.4 Flujo con comentarios: confirmar y verificar la alerta de borrador E1
- [x] 8.5 Casos de validación (obligatorios, email, selector de canal)
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 8.8 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`, puerto de
      email stub, mapeo `2a`↔`s2a`) y la trazabilidad de la US

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS,
      sin bloqueo distribuido, sin editar cliente generado, responsive)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano**
      antes de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-003-alta-consulta-exploratoria` (solo tras gate
      final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
