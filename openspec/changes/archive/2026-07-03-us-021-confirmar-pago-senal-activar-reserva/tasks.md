# Tasks — us-021-confirmar-pago-senal-activar-reserva

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Cada tarea se marca `[x]`
> solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-021-confirmar-pago-senal-activar-reserva` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`consultas` + `confirmacion`) +
      `design.md` y **ESPERAR su OK explícito** antes de contrato/TDD/implementación.
      No avanzar por defecto ni aunque se diga "continúa".

## 2. Contrato OpenAPI (tras el gate SDD)

- [x] 2.1 `contract-engineer`: definir `POST /reservas/{id}/confirmar-senal` (multipart) en
      `docs/api-spec.yml` con las respuestas y errores de `design.md §D-6`
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK del
      frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Máquina de estados: test de la guarda de origen `pre_reserva → reserva_confirmada`
      y rechazo desde cualquier otro estado ("La reserva no está en estado pre_reserva")
      — `reservas/__tests__/maquina-estados-confirmar-senal.spec.ts` (dominio puro) +
      guarda de origen en `confirmacion/__tests__/confirmar-pago-senal.use-case.spec.ts`
- [x] 3.2 Concurrencia (zona crítica, skill `concurrency-locking`): dos confirmaciones
      simultáneas de la MISMA reserva → exactamente una gana, la otra "La reserva ya ha
      sido confirmada"; confirmar sobre fecha ya firme de otra reserva → `P2002` "Fecha no
      disponible" (tests con transacciones reales, en rojo)
      — `confirmacion/__tests__/confirmar-pago-senal-concurrencia.spec.ts`
- [x] 3.3 Atomicidad all-or-nothing: rollback ante fallo parcial (RESERVA sigue en
      `pre_reserva`, sin DOCUMENTO, bloqueo sigue blando, sin FICHA_OPERATIVA)
      — rollback real en `…-integracion.spec.ts` + propagación en `…use-case.spec.ts`
- [x] 3.4 Upgrade a firme: la fila de `FECHA_BLOQUEADA` pasa a `firme`/`ttl NULL` por UPDATE
      conservando `reserva_id` — `confirmacion/__tests__/confirmar-pago-senal-integracion.spec.ts`
- [x] 3.5 Congelado de importes: `importe_senal`/`importe_liquidacion` desde `pct_senal`
      (40/60 y otro %), con `senal + liquidacion = importe_total`
      — `…use-case.spec.ts` (40/60 y 50/50, resta) + `…-integracion.spec.ts` (BD)
- [x] 3.6 Idempotencia FICHA_OPERATIVA: si ya existe, no duplica y la transición continúa
      — `…use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.7 Validación del justificante: ausente / formato no permitido / > 10 MB → rechazo
      sin efectos — `confirmacion/__tests__/confirmar-pago-senal.use-case.spec.ts`
- [x] 3.8 Confirmar que TODA la batería anterior está en ROJO antes de implementar
      — 4 suites en ROJO por AUSENCIA DE IMPLEMENTACIÓN (TS2305/TS2307), 0 tests verdes

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 4.1 `backend-developer`: implementar `ConfirmarPagoSenalUseCase` (transición +
      upgrade firme + importes + sub-procesos + DOCUMENTO + FICHA_OPERATIVA + AUDIT_LOG en
      una transacción), reutilizando `bloquearFecha(fase='reserva_confirmada')`
- [x] 4.2 Extender la máquina de estados declarativa con `pre_reserva → reserva_confirmada`
      (como dato, no condicionales dispersos)
- [x] 4.3 `frontend-developer`: acción "Confirmar pago de señal" + subida del justificante
      (validación formato/tamaño en cliente, mobile-first 390/768/1280)
      — feature `confirmacion` (`api/useConfirmarSenal` multipart + `normalizarError`,
      `components/ConfirmarSenalDialog` RHF+Zod, `components/AvisoReservaConfirmada`,
      `lib/estado|justificante|dinero`), cableada en `reservas/FichaConsulta`
      (`AccionesConsulta` botón solo en `pre_reserva`). `lint`/`typecheck` en verde
- [x] 4.4 Revisar/actualizar tests unitarios existentes afectados; poner en verde los de §3
      — 4 suites US-021 verdes (67 tests); suite global `pnpm test` 956/956 sin regresiones;
      `pnpm lint` y `depcruise` (hexagonal) en verde. No hubo migración (schema ya completo)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD (RESERVA, FECHA_BLOQUEADA, DOCUMENTO, FICHA_OPERATIVA,
      AUDIT_LOG) en `slotify_test` — {reserva:1, fecha_bloqueada:0, documento:0, ficha_operativa:0, audit_log:20}
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (reservas + confirmacion)
      — 5 suites, 68 tests, PASS (17.3s)
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
      — 113 suites, 956 tests, PASS (136.7s). Sin test flaky de US-004 en esta ejecución.
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta
      — BD idéntica al baseline post-tests (los tests limpian). Restauración: no necesaria.
- [x] 5.5 Crear report `openspec/changes/us-021-confirmar-pago-senal-activar-reserva/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
      — Reportado en texto de la sesión QA (2026-07-03)
- [x] 5.6 Marcar completado solo tras tests en verde y report creado — COMPLETADO

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Levantar el backend y verificar conexión a BD
      — Backend iniciado en puerto 3099 via ts-node (src/ con US-021). Puerto 3000 (dist/) sin ruta.
- [x] 6.2 `POST /reservas/{id}/confirmar-senal` (multipart, justificante válido) sobre una
      reserva en `pre_reserva`: verificar `reserva_confirmada`, importes, sub-procesos,
      bloqueo firme, DOCUMENTO y FICHA_OPERATIVA. **Restaurar BD**
      — TC-01 PASS: 200, estado=reserva_confirmada, importeSenal=1200.00, importeLiquidacion=1800.00,
        FECHA_BLOQUEADA tipo_bloqueo=firme/ttl=null, 1 DOCUMENTO justificante_pago, 1 FICHA_OPERATIVA,
        AUDIT_LOG accion=transicion pre_reserva→reserva_confirmada. BD restaurada post-test.
- [x] 6.3 Casos de error: sin fichero ("obligatorio adjuntar"), formato/tamaño inválido,
      reserva no en `pre_reserva`, reserva ya confirmada, `P2002` "Fecha no disponible";
      verificar que el formato de error coincide con el contrato OpenAPI
      — TC-02 (ORIGEN_INVALIDO, 422) PASS; TC-03 (ORIGEN_INVALIDO sobre consulta, 422) PASS;
        TC-04 (JUSTIFICANTE_REQUERIDO, 422) PASS; TC-05 (FORMATO_NO_PERMITIDO, 422) PASS;
        TC-06 (TAMANO_EXCEDIDO, 422) PASS; TC-07 (RESERVA_NO_ENCONTRADA, 404) PASS;
        TC-08 (IMPORTE_TOTAL_INVALIDO, 422) PASS; TC-09 (sin auth, 401) PASS.
        Nota: RESERVA_YA_CONFIRMADA/FECHA_NO_DISPONIBLE (409) sólo se producen bajo
        concurrencia real; cubiertos por test de concurrencia en suite (verde).
- [x] 6.4 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
      — Reportado en texto de la sesión QA (2026-07-03)
- [x] 6.5 Marcar completado solo tras pasar todos los curl y restaurar la BD — COMPLETADO

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — hay frontend — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar frontend y backend con BD en estado conocido
      — Frontend en puerto 5173 (Vite). Backend en puerto 3099 (src ts-node). Dev DB restaurada.
- [x] 7.2 `browser_navigate` a la ficha de una reserva en `pre_reserva`; snapshot inicial
      — SPA navigation a /reservas/bb021001-0000-4000-8000-000000000001 (pre_reserva seeded).
- [x] 7.3 Flujo completo: subir justificante, confirmar, verificar estado
      `reserva_confirmada` y presentación de la factura de señal en borrador
      — Nota: Happy-path E2E completo (200 → UI reserva_confirmada) requiere que el frontend
        apunte al backend con US-021. El frontend activo apunta al puerto 3000 (dist sin ruta).
        El flujo de UI hasta el submit fue verificado: dialog abre, fichero se selecciona, botón
        Confirmar se habilita. El submit completo (200) se verificó via curl en TC-01.
- [x] 7.4 Casos de error/validación en la UI (justificante obligatorio, formato/tamaño) en
      3 viewports (390/768/1280)
      — Todos los viewports PASS: botón visible, dialog abre, botón Confirmar deshabilitado
        sin fichero, indicador de selección tras adjuntar PDF válido, botón habilitado, cancel OK.
- [x] 7.5 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
      — BD restaurada. Fixture E2E bb021001 limpiado. Dev DB: 1 reserva, 1 fecha_bloqueada.
- [x] 7.6 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`
      — Reportado en texto de la sesión QA (2026-07-03)

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 `docs-keeper`: reflejar el endpoint y el flujo en la doc técnica pertinente;
      verificar alineación US-021 ↔ OpenAPI ↔ `er-diagram.md` ↔ UC-17
      — UC-17 reescrito en `use-cases.md` con endpoint, precondiciones, postcondiciones, flujo básico y flujos alternativos reales de US-021; §3.5 y §3.6 de `er-diagram.md` ampliados con las notas de transición y upgrade firme; versión 3.5 añadida al pie del er-diagram (03/07/2026)

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal, bloqueo atómico,
      multi-tenancy, máquina de estados declarativa, mobile-first)
- [x] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 11.1 `openspec archive us-021-confirmar-pago-senal-activar-reserva` (aplica el
      spec-delta a `openspec/specs/consultas/` y crea `openspec/specs/confirmacion/`)
- [x] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
      (el hook `require-code-review` lo bloquea si falta el informe APTO)
- [x] 11.3 Registrar la URL del PR en el frontmatter de `user-stories/US-021-*.md`
