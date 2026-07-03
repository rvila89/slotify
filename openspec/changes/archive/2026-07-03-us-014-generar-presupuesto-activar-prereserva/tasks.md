# Tasks — us-014-generar-presupuesto-activar-prereserva

> Orden y pasos obligatorios según `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Los reports viven en
> `openspec/changes/us-014-generar-presupuesto-activar-prereserva/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Crear branch `feature/us-014-generar-presupuesto-activar-prereserva` desde `master`
- [x] 0.2 Verificar la branch creada y que es la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`presupuestos`, `consultas`,
      `comunicaciones`) + `design.md` y **ESPERAR su OK explícito**
- [ ] 1.2 Confirmar decisiones abiertas del `design.md`: **D-1** (nueva capability
      `presupuestos` + módulo), **D-3** (insert-o-update fase `pre_reserva`), **D-5**
      (congelado/desglose fiscal), **D-6** (PDF: momento y proveedor), **D-7** (E2
      post-commit), **D-8** (endpoints), **D-9** (migración/seed)
- [ ] 1.3 No avanzar a contrato/TDD/implementación sin el OK humano (aunque se diga
      "continúa")

## 2. Contrato OpenAPI (post-gate — dueño: contract-engineer)

- [x] 2.1 Formalizar en `docs/api-spec.yml` `POST /reservas/{id}/presupuesto/preview`
      (calcula borrador vía motor de tarifa, no persiste) y
      `POST /reservas/{id}/presupuesto` (confirma: PRESUPUESTO + `pre_reserva` + bloqueo +
      vaciado de cola + E2), con sus esquemas y códigos de error (ver `design.md §D-8`)
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml` / hook `validate-openapi`)
- [x] 2.3 Regenerar el cliente HTTP del frontend desde el contrato (nunca editarlo a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)

- [x] 3.1 **Concurrencia del bloqueo (zona crítica)**: dos confirmaciones concurrentes sobre
      la misma `(tenant_id, fecha)` —una `2.a` INSERT, otra `2.b` UPDATE— y doble clic del
      mismo presupuesto → exactamente una gana, la otra `UNIQUE(tenant_id, fecha)` / "Fecha
      no disponible"; nunca doble bloqueo (skill `concurrency-locking`)
      → `src/presupuestos/__tests__/activar-prereserva-concurrencia.spec.ts`
- [x] 3.2 **Máquina de estados**: guarda de origen `{2a,2b,2c,2v} → pre_reserva`; rechazo
      desde `2.d`/terminales/`pre_reserva`; precondición "no PRESUPUESTO enviado/aceptado"
      (skill `state-machine`)
      → `src/reservas/__tests__/maquina-estados-activar-prereserva.spec.ts` (guarda de estado
      pura) + `src/presupuestos/__tests__/generar-presupuesto.use-case.spec.ts` (precondición
      PRESUPUESTO_YA_EXISTE / ORIGEN_INVALIDO en la aplicación)
- [x] 3.3 **Tarifa congelada**: `tarifa_congelada = true`, `iva_porcentaje = 21`, desglose
      base/IVA/total; un cambio posterior del tarifario no recalcula el PRESUPUESTO
      → `src/presupuestos/__tests__/desglose-fiscal.spec.ts` (desglose puro) +
      `generar-presupuesto.use-case.spec.ts` (congelado al confirmar) +
      `activar-prereserva-integracion.spec.ts` (persistencia congelada real)
- [x] 3.4 **FA-01** datos fiscales incompletos → enumera campos, sin PRESUPUESTO, RESERVA y
      `FECHA_BLOQUEADA` intactas → `generar-presupuesto.use-case.spec.ts`
- [x] 3.5 **FA-02** >50 invitados → `tarifa_a_consultar` habilita precio manual;
      `PRESUPUESTO.total` = precio manual; sin precio no se confirma
      → `generar-presupuesto.use-case.spec.ts`
- [x] 3.6 **FA-03** cancelar borrador → sin PRESUPUESTO, sin mutación, sin email
      → `generar-presupuesto.use-case.spec.ts` (preview no persiste nada)
- [x] 3.7 **Motor sin tarifa vigente** → `TARIFA_NO_CONFIGURADA`/`TEMPORADA_NO_CONFIGURADA`,
      sin PRESUPUESTO, RESERVA intacta → `generar-presupuesto.use-case.spec.ts`
- [x] 3.8 **Bloqueo insert (2.a) vs update (2.b/2.c/2.v)** a 7 días; TTL derivado de
      `ttl_prereserva_dias` (no hardcodeado)
      → `activar-prereserva-integracion.spec.ts` (INSERT/UPDATE reales) +
      `generar-presupuesto.use-case.spec.ts` (TTL = now()+ttl_prereserva_dias del setting)
- [x] 3.9 **Vaciado de cola A16**: `2.d → 2.y`, `posicion_cola=NULL`,
      `consulta_bloqueante_id=NULL`; auditoría por cada descartada; sin emails a la cola
      → `activar-prereserva-integracion.spec.ts`
- [x] 3.10 **Atomicidad**: fallo parcial → rollback total (sin `pre_reserva` sin PRESUPUESTO,
      etc.) → `generar-presupuesto.use-case.spec.ts` (propagación por punto de fallo) +
      `activar-prereserva-integracion.spec.ts` (rollback real ante colisión FIRME)
- [x] 3.11 **E2 post-commit + idempotencia**: E2 se envía tras commit, fallo de proveedor no
      revierte, no se duplica por `(reserva_id, codigo_email)`; modo fake en test/CI
      → `activar-prereserva-integracion.spec.ts`
- [x] 3.12 Confirmar que la suite está **RED** (falla por falta de implementación) antes de
      implementar → verificado: 5 suites fallan por `Cannot find module`/`has no exported
      member` (ausencia de implementación), 0 por errores de compilación de los propios tests

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: backend-developer)

- [x] 4.1 Capability/módulo `presupuestos`: agregado PRESUPUESTO (borrador, congelado de
      tarifa, desglose fiscal, precio manual), puerto de PDF en infraestructura (hexagonal)
- [x] 4.2 Use-case UC-14 que orquesta la transacción única: motor de tarifa (US-016) →
      PRESUPUESTO congelado → transición `→ pre_reserva` (máquina declarativa) →
      `bloquearFecha(fase='pre_reserva')` insert-o-update → vaciado de cola A16 (reuso
      US-007) → AUDIT_LOG
- [x] 4.3 Disparo de E2 post-commit reutilizando el motor de email de US-045 (adjunto por
      `pdf_url`)
- [x] 4.4 Revisar/actualizar tests unitarios existentes de `reservas`/máquina de estados que
      pudieran verse afectados por la nueva transición; sin regresiones
- [x] 4.5 Verificar hooks: `no-infra-in-domain`, `no-distributed-lock`, `require-tests-first`

## 5. Frontend: implementar "Generar presupuesto" (dueño: frontend-developer)

- [x] 5.1 Acción "Generar presupuesto" en la ficha (deshabilitada en `2.d`/terminales/
      `pre_reserva`)
- [x] 5.2 Borrador editable: desglose (base, IVA 21%, extras, descuentos, total, reparto
      40/60/fianza), campo de precio manual cuando `tarifa_a_consultar`, botones
      **Confirmar**/**Cancelar**
- [x] 5.3 Manejo de errores: datos fiscales incompletos (lista de campos), tarifa no
      configurada, "Fecha no disponible" (race)
- [x] 5.4 Responsive mobile-first verificada en 390/768/1280 (regla dura); cliente HTTP
      generado, no editado a mano

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO — dueño: qa-verifier)

- [x] 6.1 Capturar baseline de BD (`PRESUPUESTO`, `RESERVA`, `FECHA_BLOQUEADA`,
      `COMUNICACION`, `AUDIT_LOG`) en `slotify_test`
- [x] 6.2 Ejecutar tests dirigidos de `presupuestos` + `reservas` (transición, bloqueo,
      cola, concurrencia)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); registrar totales, fallos, runtime y
      flaky (ver deuda conocida de concurrencia US-004 en memoria)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hubo mutación no deseada
- [x] 6.5 Crear report
      `openspec/changes/us-014-generar-presupuesto-activar-prereserva/reports/2026-07-03-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde (o excepciones documentadas) y report
      creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO — dueño: qa-verifier)

- [x] 7.1 Levantar el backend y anotar el estado de BD relevante
- [x] 7.2 `POST /reservas/{id}/presupuesto/preview` (happy path) → verificar desglose y que
      **no persiste**
- [x] 7.3 `POST /reservas/{id}/presupuesto` (confirmar) → verificar PRESUPUESTO creado,
      `pre_reserva`, TTL 7d, `FECHA_BLOQUEADA` actualizada/creada, cola vaciada, E2 (fake).
      **Restaurar BD** (borrar PRESUPUESTO/COMUNICACION, revertir RESERVA y FECHA_BLOQUEADA)
- [x] 7.4 Errores: FA-01 datos fiscales (422 con lista), FA-02 precio manual, motor sin
      tarifa (`TARIFA_NO_CONFIGURADA`), guarda de origen (`2.d`/terminal → 409/422),
      presupuesto existente (remite a UC-15), "Fecha no disponible" (race)
- [x] 7.5 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.6 Crear report
      `openspec/changes/us-014-generar-presupuesto-activar-prereserva/reports/2026-07-03-step-N+2-curl-endpoint-tests.md`
      y confirmar BD restaurada

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO — dueño: qa-verifier)

- [x] 8.1 Levantar frontend y backend; BD en estado conocido; comprobar tools de Playwright
      MCP
- [x] 8.2 Navegar a la ficha de una consulta en `2.b` con datos completos y CLIENTE con datos
      fiscales
- [x] 8.3 Flujo completo: "Generar presupuesto" → revisar borrador → **Confirmar** →
      verificar transición a `pre_reserva` en la UI y persistencia en BD
- [x] 8.4 Escenarios de error/validación en UI: FA-01 (datos fiscales), FA-02 (precio
      manual), FA-03 (cancelar), tarifa no configurada
- [x] 8.5 Verificar responsive en 390/768/1280 (capturas)
- [x] 8.6 Restaurar entorno y BD; cerrar sesiones de navegador
- [x] 8.7 Crear report
      `openspec/changes/us-014-generar-presupuesto-activar-prereserva/reports/2026-07-03-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)

- [x] 9.1 Sincronizar `docs/` afectada (estados de RESERVA, PRESUPUESTO, flujo UC-14, E2,
      A16) con la implementación real, sin duplicar la spec
- [x] 9.2 Verificar coherencia con `er-diagram.md §3.11 PRESUPUESTO` y el mapa canónico de
      bloqueo

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)

- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, bloqueo
      atómico sin locks distribuidos, TDD, contrato, responsive, arrow functions,
      multi-tenancy/RLS)
- [x] 10.2 Dejar informe
      `openspec/changes/us-014-generar-presupuesto-activar-prereserva/reports/2026-07-03-step-review-code-review.md`
      con la línea literal `Veredicto: APTO` (o `NO APTO` → volver a implementación y repetir)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 11.1 Tras code-review **APTO** + validación manual, presentar el resultado al humano y
      **ESPERAR su OK explícito** antes de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)

- [ ] 12.1 `openspec archive us-014-generar-presupuesto-activar-prereserva` (aplica el delta
      a `openspec/specs/`: nueva capability `presupuestos`, actualiza `consultas` y
      `comunicaciones`) — solo tras gate final y code-review APTO (hook `require-code-review`)
- [ ] 12.2 Abrir PR (GitHub MCP o `gh`); actualizar el frontmatter de la US con la PR
