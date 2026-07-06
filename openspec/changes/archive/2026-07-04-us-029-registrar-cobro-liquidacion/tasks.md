# Tasks — us-029-registrar-cobro-liquidacion

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E si aplica); **nunca** las delega en el usuario. Cada tarea se marca
> `[x]` solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-029-registrar-cobro-liquidacion` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion` MODIFICADA) + `design.md`
      y **ESPERAR su OK explícito** antes de contrato/TDD/implementación. **OK humano recibido.** No avanzar por defecto
      ni aunque se diga "continúa". Puntos clave a validar: **D-1** (¿`tenant_id` en PAGO?;
      ¿`UNIQUE(factura_id)` o guarda por estado?), **D-2** (atomicidad estado↔PAGO con
      `SELECT ... FOR UPDATE` sobre RESERVA contra el doble cobro), **D-4** (justificante ya
      subido vía `justificante_doc_id` vs. `multipart` en la petición de cobro).

## 2. Contrato OpenAPI (tras el gate SDD — SÍ toca API)

- [x] 2.1 `contract-engineer`: definido en `docs/api-spec.yml` el endpoint de cobro
      (`POST /reservas/{id}/facturas/liquidacion/cobro`, operationId `registrarCobroLiquidacion`,
      tag `Facturacion`) con body `RegistrarCobroLiquidacionRequest` `{ importe (>0), fechaCobro
      (date, ≤ hoy), justificanteDocId? }`, respuesta `RegistrarCobroLiquidacionResponse` (PAGO
      creado vía `PagoLiquidacion`, FACTURA `cobrada`, `liquidacionStatus='cobrada'`,
      `alertaDiscrepancia?` vía `AlertaDiscrepanciaCobro`) y errores `CobroLiquidacionError`
      (`409 LIQUIDACION_YA_COBRADA` doble cobro, `409 LIQUIDACION_NO_FACTURADA` precondición
      `pendiente`, `400 COBRO_INVALIDO` validación `importe`/`fechaCobro`,
      `404 FACTURA_LIQUIDACION_NO_ENCONTRADA`/`JUSTIFICANTE_NO_ENCONTRADO`, `401`, `403`). La
      alerta de discrepancia se modela como campo OPCIONAL de la respuesta 200 (NO error). Ver
      `design.md §D-3/§D-4`
- [x] 2.2 Contrato validado (openapi-typescript parsea el spec completo sin errores; YAML + refs
      OK; spectral/redocly no instalados en el entorno → validación autoritativa vía codegen) y SDK
      del frontend REGENERADO (`pnpm generate-client` → `apps/web/src/api-client/schema.d.ts`, nunca
      editado a mano); DTOs `@nestjs/swagger` del backend sincronizados en
      `apps/api/src/facturacion/interface/factura.dto.ts`

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Validaciones de dominio puro: `importe > 0` y `fecha_cobro ≤ hoy` (rechazo si futura o
      importe no positivo) — `facturacion/domain/__tests__/validar-cobro.spec.ts`
- [x] 3.2 Detección de discrepancia (dominio puro): `importe !== total` devuelve la discrepancia
      (facturado/cobrado/diferencia); `importe === total` no alerta —
      `facturacion/domain/__tests__/detectar-discrepancia.spec.ts`
- [x] 3.3 Guarda de precondición (máquina de estados): `facturada` procede; `pendiente` bloquea;
      `cobrada` bloquea (doble cobro) — `facturacion/domain/__tests__/puede-registrar-cobro.spec.ts`
- [x] 3.4 Registro del cobro (use-case): precondición `liquidacion_status='facturada'` +
      `FACTURA(liquidacion).estado='enviada'`; al confirmar → crea `PAGO`
      (`factura_id`,`importe`,`fecha_cobro`), `FACTURA.estado='cobrada'`,
      `liquidacion_status='cobrada'`, `AUDIT_LOG` `crear`+`actualizar` —
      `facturacion/__tests__/registrar-cobro-liquidacion.use-case.spec.ts`
- [x] 3.5 Justificante opcional: sin documento → `PAGO.justificante_doc_id=NULL`, estado avanza
      a `cobrada`; con documento → crea `DOCUMENTO(tipo='justificante_pago')` y lo referencia —
      `…registrar-cobro-liquidacion.use-case.spec.ts`
- [x] 3.6 Discrepancia no bloquea: `importe=4.000` sobre factura de `4.100` → crea `PAGO` con
      `4.000`, avanza a `cobrada`, devuelve `alertaDiscrepancia`, registra en `AUDIT_LOG` —
      `…use-case.spec.ts`
- [x] 3.7 Atomicidad + doble cobro concurrente: dos registros concurrentes sobre `facturada`
      resuelven con `SELECT ... FOR UPDATE` sobre RESERVA → un único `PAGO`, la segunda aborta;
      transacción real, sin locks distribuidos —
      `facturacion/__tests__/registrar-cobro-concurrencia.spec.ts`
- [x] 3.8 Bloqueos: `pendiente` bloquea con el mensaje de precondición; `cobrada` bloquea con el
      mensaje de doble cobro; ningún `PAGO` creado en ambos casos — `…use-case.spec.ts`
- [x] 3.9 Confirmar que TODA la batería anterior está en ROJO antes de implementar (por AUSENCIA
      DE IMPLEMENTACIÓN), 0 tests verdes — verificado: 5 suites en RED por `TS2307` (módulos de
      producción ausentes `validar-cobro` / `detectar-discrepancia` / `puede-registrar-cobro` /
      `registrar-cobro-liquidacion.use-case`), 0 tests verdes. El flaky pre-existente US-004
      (deadlock 40P01) es ajeno a estos ficheros

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 4.1 Verificar/crear el modelo: **tabla `PAGO`** (`id_pago`, `factura_id` FK, `importe
      DECIMAL(10,2)`, `fecha_cobro DATE`, `justificante_doc_id` FK nullable → DOCUMENTO,
      `fecha_creacion`, y **`tenant_id` (D-1 APROBADO en gate)**) vía **migración aditiva**
      (`20260704150000_us029_pago_tenant_id`: añade `tenant_id` + FK a TENANT + índices, backfill
      desde FACTURA, RLS por `tenant_id` directo; SIN `UNIQUE(factura_id)`). `FACTURA.estado`,
      `RESERVA.liquidacion_status` y `DOCUMENTO.tipo` ya admiten `cobrada`/`justificante_pago`
      (sin migración de enums)
- [x] 4.2 `backend-developer`: funciones de dominio puro `validarCobro`, `detectarDiscrepancia`,
      `puedeRegistrarCobro`; `RegistrarCobroLiquidacionUseCase` (orquestación atómica según
      `design.md §D-2`: `$transaction` + `SELECT ... FOR UPDATE` sobre RESERVA + guarda de
      precondición/doble cobro + verificación del `DOCUMENTO` justificante si aplica + creación de
      `PAGO` + transición `FACTURA.estado='cobrada'` + `liquidacion_status='cobrada'` + AUDIT_LOG +
      alerta de discrepancia), en `apps/api/src/facturacion/**`; dominio sin imports de
      infraestructura (hexagonal, depcruise OK); adaptadores Prisma tx-bound + UoW en infra
- [x] 4.3 Exponer el endpoint `POST /reservas/{id}/facturas/liquidacion/cobro` conforme al
      contrato (§2), con validación de body (DTO `class-validator`) y mapeo de errores
      (`400 COBRO_INVALIDO`, `409 LIQUIDACION_YA_COBRADA`/`LIQUIDACION_NO_FACTURADA`,
      `404 FACTURA_LIQUIDACION_NO_ENCONTRADA`/`JUSTIFICANTE_NO_ENCONTRADO`)
- [x] 4.4 §3 en VERDE (5 suites US-029, 53 tests: dominio 17 + use-case 25 + concurrencia/BD 11);
      `pnpm typecheck` (tsc --noEmit) OK, `pnpm lint` (eslint sobre lo tocado) OK, `depcruise`
      dominio sin violaciones hexagonales. Nota: dos suites de concurrencia AJENAS a US-029
      (`generar-factura-senal-concurrencia`, `aprobar-y-enviar-concurrencia`) fallan por
      contaminación de datos de numeración en `slotify_test` (rango F-YYYY-NNNN no contiguo), no
      por este change; deuda de aislamiento de suites (afín a la memoria US-004)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD (PAGO, DOCUMENTO, FACTURA, RESERVA, AUDIT_LOG) en `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos del módulo cambiado (facturacion)
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [x] 5.5 Crear report `openspec/changes/us-029-registrar-cobro-liquidacion/reports/2026-07-04-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Levantar el backend y verificar conexión a BD
- [x] 6.2 Happy path: registrar cobro con justificante; verificar `PAGO` creado
      (`factura_id`/`importe`/`fecha_cobro`/`justificante_doc_id`), `FACTURA.estado='cobrada'`,
      `liquidacion_status='cobrada'`, `AUDIT_LOG`. **Restaurar BD**
- [x] 6.3 Cobro sin justificante: `justificante_doc_id=NULL`, estado avanza a `cobrada`.
      **Restaurar BD**
- [x] 6.4 Discrepancia de importe: `importe` ≠ `total` → `PAGO` con importe real, `alertaDiscrepancia`
      en la respuesta, discrepancia en `AUDIT_LOG`, estado `cobrada`. **Restaurar BD**
- [x] 6.5 Doble cobro: sobre reserva ya `cobrada` → `409` "ya está marcada como cobrada", sin
      `PAGO` adicional. **Restaurar BD**
- [x] 6.6 Precondición `pendiente` → bloqueo "la factura debe estar enviada antes de registrar su
      cobro", sin `PAGO`
- [x] 6.7 Casos de validación: `importe ≤ 0` (`400`), `fecha_cobro` futura (`400`), reserva/factura
      inexistente (`404`), sin auth (`401`); verificar que el formato de error coincide con el
      contrato OpenAPI
- [x] 6.8 Crear report `.../reports/2026-07-04-step-N+2-curl-endpoint-tests.md`
- [x] 6.9 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 7. QA: E2E con Playwright MCP (step-N+3 — NO APLICA en este change)

- [ ] 7.1 **N/A**: este change es backend + contrato (talla S), **sin frontend**. `required:
      false` en `config.yaml`. Si el gate SDD decidiera incluir UI del registro de cobro, se
      reactiva este paso (levantar front+back, `browser_navigate`, flujo completo, escenarios de
      error, persistencia UI↔BD, restaurar BD, report
      `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`)

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 `docs-keeper`: reflejar el flujo de cobro (registrar cobro → `PAGO` + `DOCUMENTO`
      justificante opcional → `FACTURA.estado=cobrada` + `liquidacion_status=cobrada`,
      discrepancia que alerta, guarda de doble cobro, precondición `facturada`) en la doc técnica;
      verificar alineación US-029 ↔ OpenAPI ↔ `er-diagram.md` (§3.13 PAGO —incluida la posible
      adición de `tenant_id` de D-1—, §3.15 DOCUMENTO `justificante_pago`, §3.12 FACTURA `cobrada`,
      §RESERVA `liquidacion_status`) ↔ UC-21 (pasos 7–10). Documentar que `liquidacion_status =
      cobrada` es una de las 3 precondiciones de `evento_en_curso` (US-031)

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal —dominio puro de
      validaciones/discrepancia, puerto de PAGO en dominio—, atomicidad estado↔PAGO con
      `SELECT ... FOR UPDATE` **sin locks distribuidos**, guarda de doble cobro, multi-tenancy/RLS
      en PAGO, migración aditiva de PAGO, cliente HTTP generado no editado a mano)
- [x] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)
- [x] 9.3 Refinamiento post-review (mejoras no bloqueantes del code-review, APTO ya emitido):
      (M1) endurecido `buscarJustificante` — la consulta Prisma acota por `tipo='justificante_pago'`
      Y `reservaId` además del tenant (puerto `DocumentosCobroPort.buscarJustificante` ahora recibe
      `reservaId`); un DOCUMENTO del tenant de otro tipo o de otra reserva se trata como no
      encontrado → 404 `JUSTIFICANTE_NO_ENCONTRADO`. (M2) endurecidas las aserciones de
      `registrar-cobro-concurrencia.spec.ts`: los `rejects.toBeDefined()` pasan a
      `rejects.toBeInstanceOf(...)` con la clase concreta (`LiquidacionNoFacturadaError`,
      `LiquidacionYaCobradaError`, `CobroInvalidoError`, `JustificanteNoEncontradoError`) y se añade
      un caso que verifica justificante de tipo incorrecto / de otra reserva → 404. 5 suites US-029
      en VERDE (54 tests), `lint`/`typecheck` OK

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR. **OK humano recibido: aprobado archive + PR (ciclo verde, 54 tests, lint/typecheck OK).**

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 11.1 `openspec archive us-029-registrar-cobro-liquidacion` (aplica el delta a
      `openspec/specs/facturacion/`)
- [x] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO (el hook
      `require-code-review` lo bloquea si falta el informe APTO)
- [x] 11.3 Registrar la URL del PR en el frontmatter de
      `user-stories/US-029-registrar-cobro-liquidacion.md`
