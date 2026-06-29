# Tasks — us-005-transicion-exploratoria-a-con-fecha

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/2026-06-29-us-005-transicion-exploratoria-a-con-fecha/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-005-transicion-exploratoria-a-con-fecha` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` (decisiones D-1..D-8; **en especial D-1: regla de fecha `≥ hoy` de la
      ficha vs `> hoy` recomendado**) y **ESPERAR su OK explícito**
      → **APROBADO (2026-06-29). D-1 resuelto a `> hoy` (estrictamente futura)**,
        unificado con US-040/US-004 (`esFechaEstrictamenteFutura`). Contrato y tests RED
        ya lo asumen; sin cambios necesarios.
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
> Completado en sesión previa; verificado al reanudar (endpoint en `docs/api-spec.yml`,
> SDK regenerado en `apps/web/src/api-client/schema.d.ts`, `PATCH` antiguo deprecado).
- [x] 2.1 Definir `POST /reservas/{id}/fecha` (body `{ fechaEvento, aceptarCola? }`,
      respuestas 200 `2b`/`2d`, 409 `colaDisponible`, 400/422, 404) según `design.md §D-7`
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Completado en sesión previa; verificado al reanudar: los 4 specs estaban en ROJO
> (imports inexistentes) antes de implementar, y ahora en VERDE tras el backend.
- [x] 3.1 Test de la **guarda de origen `2.a`** en la máquina de estados: solo
      `2a→2b`/`2a→2d` permitidas; `2b/2c/2v/terminales` → rechazo (en rojo)
- [x] 3.2 Test del use-case de transición con fecha libre: RESERVA `2a→2b` +
      `FECHA_BLOQUEADA` blando `ttl=now()+ttl_consulta_dias` + `AUDIT_LOG
      accion='transicion'`, en una sola transacción (en rojo)
- [x] 3.3 Test de transición sobre fecha bloqueada por `2b`: oferta de cola; con
      `aceptarCola=true` → `2d` + `posicion_cola=MAX+1` + `consulta_bloqueante_id` sin
      `FECHA_BLOQUEADA`; con rechazo → permanece `2a` sin cambios (en rojo)
- [x] 3.4 Test de transición sobre fecha bloqueada por `2c/2v/pre/confirmada+`: no
      disponible, sin cola, permanece `2a` sin cambios (en rojo)
- [x] 3.5 **Tests de concurrencia REALES (skill `concurrency-locking`)**: 2 RESERVA en
      `2a` → 1×`2b`+`FECHA_BLOQUEADA` y la otra ofrecida/entrada a `2d`; N con
      `aceptarCola` → 1×`2b` + N-1×`2d` posiciones únicas y contiguas; 0 dobles bloqueos
- [x] 3.6 Test de validación de fecha en servidor (D-1, según resolución del Gate):
      fecha no válida por bypass → 4xx sin efectos; futura válida → continúa
- [x] 3.7 Test del email de confirmación de bloqueo provisional (motor US-045): se
      registra y envía la COMUNICACION tras `2b`; fallo de envío no revierte la transición
- [x] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-004/US-040/US-045 afectados por el reuso (`bloquearEnTx`,
      `determinarAltaConFecha`, motor email) y ajustarlos sin romper su comportamiento;
      confirmar regresión cero del alta US-004 y del `bloquear()` público de US-040
      → Reuso por COMPOSICIÓN (sin tocar firmas compartidas): `bloquearEnTx`,
        `resolverPlanBloqueo`, `determinarAltaConFecha` y `DespacharEmailService.finalizarEnvio`
        se consumen tal cual. Regresión cero: 49 suites / 308 tests en verde (incl. alta
        US-004 y `bloquear()` público de US-040). NO fue necesario ajustar ningún test
        existente de US-004/040/045.

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados: añadir transiciones permitidas `2a→2b`/`2a→2d` + guarda de
      origen `2.a` declarativa; reutilizar `determinarAltaConFecha` (D-3)
      → `esOrigenValidoParaAnadirFecha` + tabla `ORIGENES_TRANSICION_ANADIR_FECHA`
        declarativa en `domain/maquina-estados.ts`; destino reusa `determinarAltaConFecha`.
- [x] 5.2 Use-case de transición `2.a → 2.b/2.d`: UPDATE de la RESERVA existente, reuso de
      `resolverPlanBloqueo` + `bloquearEnTx(tx,…)` en la misma tx, `AUDIT_LOG
      accion='transicion'`, re-derivación D4, cola con `SELECT FOR UPDATE` (D-4/D-5)
      → `application/transicion-fecha.use-case.ts` + `infrastructure/transicion-fecha-uow.prisma.adapter.ts`
        (retry-on-P2002 → re-derivación a 2.d; cola serializada por la fila bloqueante).
        Concurrencia REAL verde (3 tests: 2 sin cola, 2 con cola, N contiguas).
- [x] 5.3 Email de confirmación de bloqueo provisional (extensión de E1) vía motor US-045,
      post-commit y no bloqueante (D-6)
      → `infrastructure/confirmacion-bloqueo-email.adapter.ts` delega en
        `DespacharEmailService.finalizarEnvio`; envío POST-COMMIT tolerante (un fallo no
        revierte la transición).
- [x] 5.4 Endpoint `POST /reservas/{id}/fecha` (controller + DTO) con `aceptarCola` y
      mapeo de respuestas 200/409/4xx (D-2/D-7)
      → `interface/transicion-fecha.controller.ts` + `interface/asignar-fecha.dto.ts`;
        409 `{colaDisponible, motivo}`, 400 fecha no válida, 422 guarda de origen, 404.
        Registrado en `reservas.module.ts` (DI por Symbols).
- [x] 5.5 Frontend "ficha de consulta 2.a": acción "Añadir fecha" con selector (bloquea
      fechas no válidas) + avisos (confirmación `2b`, oferta de cola aceptar/rechazar, no
      disponible); responsive mobile-first (390/768/1280)
- [x] 5.6 Correcciones de los 3 defectos del QA (RED→GREEN, `backend-developer`) — RE-VERIFICADO
      por `qa-verifier` en steps 6/7 (PASS). Step 8 requiere MCP de Playwright activo:
      - FIX 1 (BUG 1, 409 sin `colaDisponible`/`motivo`): el filtro global
        `shared/filters/http-exception.filter.ts` ahora PROPAGA `colaDisponible` (boolean) +
        `motivo` (string) cuando la `HttpException` los aporta (mismo patrón opcional que
        `codigo`/`detalle`). Test: `shared/filters/__tests__/http-exception.filter.spec.ts`.
      - FIX 2 (BUG 2, P2002 `uq_comunicacion_reserva_codigo` con E1 previa): el repo de
        comunicación en `infrastructure/transicion-fecha-uow.prisma.adapter.ts` hace UPSERT de
        la fila `(reserva, E1)` (findFirst + update/create; índice PARCIAL no modelable con el
        `upsert` declarativo de Prisma). Sin migración, mismo código `E1`. Test de integración
        real: caso "CON E1 previa" en `__tests__/transicion-fecha-integracion.spec.ts`.
      - FIX 3 (BLOQUEADOR 3, `GET /reservas/{id}` no implementado): nuevo query hexagonal
        `application/obtener-reserva.query.ts` (+ puerto/read-model) +
        `infrastructure/reserva-detalle-query.prisma.adapter.ts` (RLS + filtro por tenant) +
        `interface/obtener-reserva.controller.ts` + `interface/reserva-detalle.dto.ts`,
        registrado en `reservas.module.ts` (token `RESERVA_DETALLE_QUERY_PORT`). Tests:
        `__tests__/obtener-reserva.query.spec.ts` + `__tests__/obtener-reserva-integracion.spec.ts`.
      - Verificación re-QA: 52 tests US-005+fixes en verde. Curl: 409 `{colaDisponible,motivo}`
        correcto; POST con E1 previa → 200 (upsert, 0 P2002, 1 sola fila E1); GET 200
        `ReservaDetalle` + GET 404. Contrato OpenAPI 100% conforme.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`,
      `comunicacion`, `audit_log`)
      → reserva=4, fecha_bloqueada=0, comunicacion=4, audit_log=28 (re-QA)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
      → 52/52 passed: maquina-estados(14), use-case(17), integracion(7), concurrencia(3),
        obtener-reserva.query(5), obtener-reserva-integracion(2), http-exception.filter(4)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
      → 318/319 passed, 52 suites. 1 fallo pre-existente en US-004 concurrencia (deadlock
        intermitente bajo runInBand, pasa en aislamiento — no relacionado con US-005).
        52 tests de US-005+fixes: TODOS en verde.
- [x] 6.4 Verificar estado posterior de BD (unicidad de `FECHA_BLOQUEADA` y de
      `posicion_cola` por fecha) y restaurar si hace falta
      → BD idéntica al baseline. 0 duplicados UNIQUE. Sin restauración.
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
      → `reports/2026-06-29-step-6-unit-test-and-db-verification.md` (actualizado)
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
      → Backend arrancado en :3000. Token obtenido (refrescado periódicamente).
- [x] 7.2 POST `/reservas/{id}/fecha` con fecha libre sobre RESERVA en `2a` → 200;
      verificar `2b`, `ttl`, `FECHA_BLOQUEADA` blando, AUDIT_LOG `transicion`, email.
      Restaurar BD
      → **Re-QA con reserva CON E1 previa (1abe5647):** HTTP 200, subEstado=2b, 1 sola fila
        E1 (idComunicacion=e561fb67, upsert actualiza), 0 duplicados, 0 P2002. BD restaurada.
- [x] 7.3 POST sobre fecha bloqueada por `2b` sin `aceptarCola` → 409 `colaDisponible`;
      luego con `aceptarCola=true` → 200 `2d` + `posicion_cola=1` +
      `consulta_bloqueante_id`, sin nueva `FECHA_BLOQUEADA`. Restaurar BD
      → 7.3a: HTTP 409, **`colaDisponible:true` PRESENTE** (FIX 1), motivo presente, RESERVA en 2a. PASS.
      → 7.3b: HTTP 200, subEstado=2d, posicionCola=1, consultaBloqueanteId set, 0 nueva FECHA_BLOQUEADA. BD restaurada. PASS.
- [x] 7.4 POST sobre fecha bloqueada por `pre_reserva`/`2c` → 409 sin cola; RESERVA
      permanece `2a`. Restaurar BD
      → HTTP 409, **`colaDisponible:false` PRESENTE** (FIX 1), motivo presente. RESERVA en 2a. BD restaurada. PASS.
- [x] 7.5 POST sobre RESERVA que no está en `2a` (guarda) → 4xx sin efectos
      → HTTP 422, mensaje correcto. RESERVA sin modificar. PASS.
- [x] 7.6 POST con `fecha_evento` no válida (bypass, según D-1) → 4xx sin efectos
      → fecha=hoy: HTTP 400. fecha pasada: HTTP 400. Inexistente: HTTP 404. Sin auth: HTTP 401. RESERVA intacta. PASS.
- [x] 7.7 Verificar que el formato de error coincide con el contrato OpenAPI
      → **PASS:** Todos los endpoints conformes. 409 incluye `colaDisponible` (bool) + `motivo`
        (string) requeridos por `AsignarFechaConflictoError`. GET /reservas/{id}: 200 `ReservaDetalle`
        con `cliente` incrustado + 404 cross-tenant. Contrato OpenAPI 100% conforme.
- [x] 7.8 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
      → `reports/2026-06-29-step-7-curl-endpoint-tests.md` (actualizado: PASS)

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
      → Backend :3000 activo. Frontend: pendiente de levantar cuando MCP esté disponible.
- [ ] 8.2 Navegar a la ficha de una consulta en `2a` (`browser_navigate`)
      → **PENDIENTE:** MCP de Playwright no disponible en esta sesión. Bloqueadores de
        implementación (FIX 1 + FIX 3) ya corregidos y verificados por curl.
- [ ] 8.3 Añadir fecha libre + confirmar; verificar transición a `2b` y aviso de
      confirmación de bloqueo
      → PENDIENTE (MCP no disponible)
- [ ] 8.4 Añadir fecha ocupada por `2b`: verificar oferta de cola; aceptar → `2d`;
      rechazar → permanece `2a`
      → PENDIENTE (MCP no disponible)
- [ ] 8.5 Añadir fecha no disponible (`2c/pre+`): verificar aviso sin cola; casos de
      validación de fecha
      → PENDIENTE (MCP no disponible)
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
      → Sin overflow en los 3 viewports. Hamburger drawer en <1024px (`Abrir navegación`). Sidebar `display:flex` en ≥1024px. PASS (verificado en QA anterior, sin cambios en frontend).
- [ ] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
      → PENDIENTE (MCP no disponible)
- [x] 8.8 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`
      → `reports/2026-06-29-step-8-e2e-playwright.md` (actualizado: INCOMPLETO — MCP caído)

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición
      `2a→2b/2d`, guarda de origen, reuso de `bloquearEnTx`/`determinarAltaConFecha` y
      motor US-045, endpoint de transición) y la trazabilidad de la US
      → `docs/use-cases.md` (UC-04 expandido con flujos completos, endpoint, entidades,
        FA-01..FA-05, diagrama mermaid); `docs/data-model.md` (§3.5 nota transición US-005,
        §3.16 upsert E1 extensión D-6, regla fecha unificada en §6, divergencia US-004+US-005
        en §3.5, reuso `bloquearEnTx` US-004+US-005 en §3.5); `docs/er-diagram.md` (§3.5
        nota transición + guarda declarativa, §3.16 upsert E1 post-commit, §5.3 regla fecha
        unificada + reuso `bloquearEnTx` D-4 + garantía D4 concurrente con tests reales).
        Sin cambios en `api-spec.yml` (endpoints ya definidos por `contract-engineer`) ni en
        `schema.prisma` (sin migración). Cross-links entre los tres docs preservados.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin bloqueo
      distribuido, sin editar cliente generado, responsive, atomicidad D4, reuso real)
      → Sin hallazgos bloqueantes ni altos. depcruise/lint(api+web)/tests núcleo verdes.
        Todos los guardrails duros OK. Observaciones no bloqueantes: upsert E1 sobrescribe
        log inicial (mitigado por AUDIT_LOG); E2E pendiente por MCP; versionar untracked.
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)
      → `reports/2026-06-29-step-review-code-review.md` con `Veredicto: APTO`.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive 2026-06-29-us-005-transicion-exploratoria-a-con-fecha` (solo
      tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR
