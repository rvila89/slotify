# Tasks — us-005-transicion-exploratoria-a-con-fecha

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/2026-06-29-us-005-transicion-exploratoria-a-con-fecha/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-005-transicion-exploratoria-a-con-fecha` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` (decisiones D-1..D-8; **en especial D-1: regla de fecha `≥ hoy` de la
      ficha vs `> hoy` recomendado**) y **ESPERAR su OK explícito**
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [ ] 2.1 Definir `POST /reservas/{id}/fecha` (body `{ fechaEvento, aceptarCola? }`,
      respuestas 200 `2b`/`2d`, 409 `colaDisponible`, 400/422, 404) según `design.md §D-7`
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde
- [ ] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [ ] 3.1 Test de la **guarda de origen `2.a`** en la máquina de estados: solo
      `2a→2b`/`2a→2d` permitidas; `2b/2c/2v/terminales` → rechazo (en rojo)
- [ ] 3.2 Test del use-case de transición con fecha libre: RESERVA `2a→2b` +
      `FECHA_BLOQUEADA` blando `ttl=now()+ttl_consulta_dias` + `AUDIT_LOG
      accion='transicion'`, en una sola transacción (en rojo)
- [ ] 3.3 Test de transición sobre fecha bloqueada por `2b`: oferta de cola; con
      `aceptarCola=true` → `2d` + `posicion_cola=MAX+1` + `consulta_bloqueante_id` sin
      `FECHA_BLOQUEADA`; con rechazo → permanece `2a` sin cambios (en rojo)
- [ ] 3.4 Test de transición sobre fecha bloqueada por `2c/2v/pre/confirmada+`: no
      disponible, sin cola, permanece `2a` sin cambios (en rojo)
- [ ] 3.5 **Tests de concurrencia REALES (skill `concurrency-locking`)**: 2 RESERVA en
      `2a` → 1×`2b`+`FECHA_BLOQUEADA` y la otra ofrecida/entrada a `2d`; N con
      `aceptarCola` → 1×`2b` + N-1×`2d` posiciones únicas y contiguas; 0 dobles bloqueos
- [ ] 3.6 Test de validación de fecha en servidor (D-1, según resolución del Gate):
      fecha no válida por bypass → 4xx sin efectos; futura válida → continúa
- [ ] 3.7 Test del email de confirmación de bloqueo provisional (motor US-045): se
      registra y envía la COMUNICACION tras `2b`; fallo de envío no revierte la transición
- [ ] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [ ] 4.1 Revisar tests de US-004/US-040/US-045 afectados por el reuso (`bloquearEnTx`,
      `determinarAltaConFecha`, motor email) y ajustarlos sin romper su comportamiento;
      confirmar regresión cero del alta US-004 y del `bloquear()` público de US-040

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [ ] 5.1 Máquina de estados: añadir transiciones permitidas `2a→2b`/`2a→2d` + guarda de
      origen `2.a` declarativa; reutilizar `determinarAltaConFecha` (D-3)
- [ ] 5.2 Use-case de transición `2.a → 2.b/2.d`: UPDATE de la RESERVA existente, reuso de
      `resolverPlanBloqueo` + `bloquearEnTx(tx,…)` en la misma tx, `AUDIT_LOG
      accion='transicion'`, re-derivación D4, cola con `SELECT FOR UPDATE` (D-4/D-5)
- [ ] 5.3 Email de confirmación de bloqueo provisional (extensión de E1) vía motor US-045,
      post-commit y no bloqueante (D-6)
- [ ] 5.4 Endpoint `POST /reservas/{id}/fecha` (controller + DTO) con `aceptarCola` y
      mapeo de respuestas 200/409/4xx (D-2/D-7)
- [ ] 5.5 Frontend "ficha de consulta 2.a": acción "Añadir fecha" con selector (bloquea
      fechas no válidas) + avisos (confirmación `2b`, oferta de cola aceptar/rechazar, no
      disponible); responsive mobile-first (390/768/1280)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`,
      `comunicacion`, `audit_log`)
- [ ] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [ ] 6.4 Verificar estado posterior de BD (unicidad de `FECHA_BLOQUEADA` y de
      `posicion_cola` por fecha) y restaurar si hace falta
- [ ] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [ ] 7.2 POST `/reservas/{id}/fecha` con fecha libre sobre RESERVA en `2a` → 200;
      verificar `2b`, `ttl`, `FECHA_BLOQUEADA` blando, AUDIT_LOG `transicion`, email.
      Restaurar BD
- [ ] 7.3 POST sobre fecha bloqueada por `2b` sin `aceptarCola` → 409 `colaDisponible`;
      luego con `aceptarCola=true` → 200 `2d` + `posicion_cola=1` +
      `consulta_bloqueante_id`, sin nueva `FECHA_BLOQUEADA`. Restaurar BD
- [ ] 7.4 POST sobre fecha bloqueada por `pre_reserva`/`2c` → 409 sin cola; RESERVA
      permanece `2a`. Restaurar BD
- [ ] 7.5 POST sobre RESERVA que no está en `2a` (guarda) → 4xx sin efectos
- [ ] 7.6 POST con `fecha_evento` no válida (bypass, según D-1) → 4xx sin efectos
- [ ] 7.7 Verificar que el formato de error coincide con el contrato OpenAPI
- [ ] 7.8 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [ ] 8.2 Navegar a la ficha de una consulta en `2a` (`browser_navigate`)
- [ ] 8.3 Añadir fecha libre + confirmar; verificar transición a `2b` y aviso de
      confirmación de bloqueo
- [ ] 8.4 Añadir fecha ocupada por `2b`: verificar oferta de cola; aceptar → `2d`;
      rechazar → permanece `2a`
- [ ] 8.5 Añadir fecha no disponible (`2c/pre+`): verificar aviso sin cola; casos de
      validación de fecha
- [ ] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [ ] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [ ] 8.8 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [ ] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición
      `2a→2b/2d`, guarda de origen, reuso de `bloquearEnTx`/`determinarAltaConFecha` y
      motor US-045, endpoint de transición) y la trazabilidad de la US

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin bloqueo
      distribuido, sin editar cliente generado, responsive, atomicidad D4, reuso real)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive 2026-06-29-us-005-transicion-exploratoria-a-con-fecha` (solo
      tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
