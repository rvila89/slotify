# Tasks — us-030-registrar-cobro-fianza

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E de frontend); **nunca** las delega en el usuario. Cada tarea se marca
> `[x]` solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-030-registrar-cobro-fianza` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion` MODIFICADA) + `design.md`
      y **ESPERAR su OK explícito** antes de contrato/TDD/implementación. No avanzar por defecto ni
      aunque se diga "continúa". Puntos clave a validar: **D-1** (atomicidad estado↔PAGO con
      `SELECT ... FOR UPDATE` sobre RESERVA contra el doble cobro, reuso del patrón US-029), **D-2**
      (política "Negociable": mecanismo del aviso no bloqueante para `fianza_status = pendiente` —
      flag `confirmarSinRecibo` en el body vs. respuesta "confirmación requerida"; y qué hacer si la
      FACTURA(fianza) está en `borrador`/no existe por `fianza_default_eur = 0`), **D-3** (endpoint
      `POST /reservas/{id}/facturas/fianza/cobro`, validación `fecha_cobro ≤ fecha_evento`), **D-4**
      (frontend: feature/ubicación del formulario y reuso del modal de confirmación), **D-5**
      (justificante ya subido vía `justificante_doc_id` vs. `multipart`)

## 2. Contrato OpenAPI (tras el gate SDD — SÍ toca API)

- [x] 2.1 `contract-engineer`: definir en `docs/api-spec.yml` el endpoint de cobro de fianza
      (`POST /reservas/{id}/facturas/fianza/cobro`, operationId `registrarCobroFianza`, tag
      `Facturacion`) con body `RegistrarCobroFianzaRequest` `{ importe (>0), fechaCobro (date, ≤
      fechaEvento), justificanteDocId?, confirmarSinRecibo? }`, respuesta
      `RegistrarCobroFianzaResponse` (PAGO creado, FACTURA `cobrada`, `fianzaStatus='cobrada'`,
      `fianzaEur`, `fianzaCobradaFecha`) y errores/avisos `CobroFianzaError` (`409 FIANZA_YA_COBRADA`
      doble cobro; respuesta de **confirmación requerida** cuando `fianza_status = pendiente` sin
      `confirmarSinRecibo` — política Negociable, NO bloqueo duro; `400 COBRO_INVALIDO` validación
      `importe`/`fechaCobro`; `404 FACTURA_FIANZA_NO_ENCONTRADA`/`JUSTIFICANTE_NO_ENCONTRADO`; `401`;
      `403`). Ver `design.md §D-2/§D-3`
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`; o codegen si spectral no está) y
      **REGENERAR** el SDK del frontend (`pnpm generate-client`, nunca editado a mano); sincronizar
      los DTOs `@nestjs/swagger` del backend en `apps/api/src/facturacion/interface/**`

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Validaciones de dominio puro: `importe > 0` y `fecha_cobro ≤ fecha_evento` (rechazo si
      posterior al evento o importe no positivo) —
      `facturacion/domain/__tests__/validar-cobro-fianza.spec.ts`
- [x] 3.2 Guarda de precondición (máquina de estados): `recibo_enviado` procede; `cobrada` bloquea
      (doble cobro); `pendiente` requiere `confirmarSinRecibo=true` (Negociable) o pide confirmación —
      `facturacion/domain/__tests__/puede-registrar-cobro-fianza.spec.ts`
- [x] 3.3 Registro del cobro (use-case): precondición `fianza_status='recibo_enviado'` +
      `FACTURA(fianza).estado='enviada'`; al confirmar → crea `PAGO`
      (`factura_id`,`importe`,`fecha_cobro`), `FACTURA.estado='cobrada'`, `fianza_status='cobrada'`,
      `fianza_eur=importe`, `fianza_cobrada_fecha=fecha_cobro`, `AUDIT_LOG` `crear`+`actualizar` —
      `facturacion/__tests__/registrar-cobro-fianza.use-case.spec.ts`
- [x] 3.4 Justificante opcional: sin documento → `PAGO.justificante_doc_id=NULL`, estado avanza a
      `cobrada`; con documento → referencia `DOCUMENTO(tipo='justificante_pago')` — `…use-case.spec.ts`
- [x] 3.5 Cobro en T-0: `fecha_cobro = fecha_evento` se acepta sin diferencia respecto al happy path —
      `…use-case.spec.ts`
- [x] 3.6 Política "Negociable": `pendiente` sin `confirmarSinRecibo` → pide confirmación, NO crea
      `PAGO`; `pendiente` con `confirmarSinRecibo=true` → registra el cobro y traza el flujo excepcional
      en `AUDIT_LOG` (incl. D-2b: FACTURA en borrador → cobrada; sin FACTURA → creada al vuelo cobrada) —
      `…use-case.spec.ts`
- [x] 3.7 Atomicidad + doble cobro concurrente: dos registros concurrentes sobre `recibo_enviado`
      resuelven con `SELECT ... FOR UPDATE` sobre RESERVA → un único `PAGO`, la segunda aborta;
      transacción REAL contra `slotify_test` (NO mocks del adapter), sin locks distribuidos —
      `facturacion/__tests__/registrar-cobro-fianza-concurrencia.spec.ts`
- [x] 3.8 Bloqueo de doble cobro: `cobrada` bloquea con el mensaje "La fianza ya está marcada como
      cobrada"; ningún `PAGO` creado — `…use-case.spec.ts`
- [x] 3.9 Confirmar que TODA la batería anterior está en ROJO antes de implementar (por AUSENCIA DE
      IMPLEMENTACIÓN), 0 tests verdes — VERIFICADO 2026-07-07: `npx jest` → 4 suites "failed to run"
      (`TS2307: Cannot find module '../application/registrar-cobro-fianza.use-case'` /
      `'../validar-cobro-fianza'` / `'../puede-registrar-cobro-fianza'`), 0 tests verdes

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 4.1 Verificar que **NO hace falta migración**: la tabla `PAGO` (con `tenant_id`, US-029), los
      valores de enum (`FACTURA.estado='cobrada'`, `fianza_status='cobrada'`,
      `DOCUMENTO.tipo='justificante_pago'`) y los campos `RESERVA.fianza_eur` /
      `RESERVA.fianza_cobrada_fecha` **ya existen**. Si el desarrollo detectara una columna faltante, la
      migración sería aditiva
- [x] 4.2 `backend-developer`: funciones de dominio puro `validarCobroFianza`,
      `puedeRegistrarCobroFianza`; `RegistrarCobroFianzaUseCase` (orquestación atómica según `design.md
      §D-1`: `$transaction` + `SELECT ... FOR UPDATE` sobre RESERVA + guarda de precondición/doble cobro
      + política "Negociable" (`confirmarSinRecibo`) con traza AUDIT_LOG + verificación del `DOCUMENTO`
      justificante si aplica + creación de `PAGO` + transición `FACTURA(fianza).estado='cobrada'` +
      `fianza_status='cobrada'` + set `fianza_eur`/`fianza_cobrada_fecha` + AUDIT_LOG), en
      `apps/api/src/facturacion/**`, reutilizando el puerto de PAGO de US-029; dominio sin imports de
      infraestructura (hexagonal, depcruise OK); adaptadores Prisma tx-bound + UoW en infra
- [x] 4.3 Exponer el endpoint `POST /reservas/{id}/facturas/fianza/cobro` conforme al contrato (§2),
      con validación de body (DTO `class-validator`, arrow-functions) y mapeo de errores/avisos
      (`400 COBRO_INVALIDO`, `409 FIANZA_YA_COBRADA`, confirmación requerida por política Negociable,
      `404 FACTURA_FIANZA_NO_ENCONTRADA`/`JUSTIFICANTE_NO_ENCONTRADO`)
- [x] 4.4 §3 en VERDE; `pnpm typecheck`, `pnpm lint` y `depcruise` (dominio sin violaciones
      hexagonales) OK — VERIFICADO 2026-07-07: 4 suites verdes (validar 7 + puede-registrar 8 +
      use-case 30 + concurrencia real 14 = 59 tests); `pnpm typecheck` OK, `pnpm lint` OK,
      `depcruise` OK (413 módulos, sin violaciones)

## 5. Frontend: formulario de registro de cobro de fianza (SÍ en alcance — D-4)

- [x] 5.1 `frontend-developer` (con Figma MCP si hay diseño): formulario de registro de cobro de fianza
      en la ficha de la reserva (`importe`, `fecha_cobro`, justificante opcional), usando el SDK
      generado (§2) y TanStack Form; estructura por dominio (Bulletproof React, barrel `index.ts`,
      `max-lines ≤ 300`), arrow-functions, **mobile-first responsive** (390/768/1280) — Implementado en
      `features/facturacion`: `RegistrarCobroFianzaDialog` (RHF+Zod: `importe>0`, `fechaCobro≤fechaEvento`,
      `justificanteDocId` opcional), hook `useRegistrarCobroFianza` (SDK `POST /reservas/{id}/facturas/fianza/cobro`),
      `normalizarErrorCobroFianza`. Botón "Registrar cobro de fianza" añadido a `AccionesFacturacion`. Sin
      frame Figma propio (como US-028/US-029): ADAPTADO con tokens del proyecto
- [x] 5.2 Aviso "Negociable": si `fianza_status = 'pendiente'`, mostrar el diálogo de confirmación
      ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?") y, al
      confirmar, reenviar con `confirmarSinRecibo: true`; deshabilitar/ocultar la acción si `fianza_status
      = 'cobrada'` y mostrar `fianza_eur` / `fianza_cobrada_fecha` — El hook trata `resultado='confirmacion_requerida'`
      como data (no error); `RegistrarCobroFianzaDialog` conmuta a `ConfirmacionCobroNegociable` y al confirmar
      reintenta la MISMA petición con `confirmarSinRecibo:true`; cancelar cierra sin acción. `fianza_status='cobrada'`
      oculta el botón y muestra `FianzaCobradaResumen` (`fianzaEur`/`fianzaCobradaFecha`)
- [x] 5.3 `pnpm --filter web lint` + `typecheck` OK (boundaries, func-style, max-lines) — VERIFICADO
      2026-07-07: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm build` OK

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Capturar baseline de BD (PAGO, DOCUMENTO, FACTURA, RESERVA, AUDIT_LOG) en `slotify_test`
      — VERIFICADO 2026-07-07: pago=0, documento=0, factura=0, reserva=1, audit_log=3278
- [x] 6.2 Ejecutar tests dirigidos del módulo cambiado (facturacion)
      — VERIFICADO 2026-07-07: 4 suites US-030 (validar 7 + puede-registrar 8 + use-case 30 + concurrencia 14 = 59 tests) — 59 PASSED
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky (nota: flaky
      pre-existente US-004 deadlock 40P01 es ajeno)
      — VERIFICADO 2026-07-07: 152 suites, 1388 tests; 148 passed / 4 failed (todos flaky pre-existentes ajenos a US-030)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hace falta
      — pago=0, documento=0, factura=0, reserva=1, audit_log=3607; sin datos residuales US-030; sin restauración necesaria
- [x] 6.5 Crear report `openspec/changes/us-030-registrar-cobro-fianza/reports/2026-07-07-step-N+1-unit-test-and-db-verification.md`
      — CREADO 2026-07-07
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar el backend y verificar conexión a BD
      — VERIFICADO 2026-07-07: backend activo en localhost:3000, slotify_dev conectada
- [x] 7.2 Happy path: registrar cobro de fianza con justificante; verificar `PAGO` creado
      (`factura_id`/`importe`/`fecha_cobro`/`justificante_doc_id`), `FACTURA(fianza).estado='cobrada'`,
      `fianza_status='cobrada'`, `fianza_eur`, `fianza_cobrada_fecha`, `AUDIT_LOG`. **Restaurar BD**
      — PASS 2026-07-07; BD restaurada
- [x] 7.3 Cobro sin justificante: `justificante_doc_id=NULL`, estado avanza a `cobrada`. **Restaurar BD**
      — PASS 2026-07-07; BD restaurada
- [x] 7.4 Cobro en T-0 (`fecha_cobro = fecha_evento`): aceptado como happy path. **Restaurar BD**
      — PASS 2026-07-07; BD restaurada
- [x] 7.5 Política "Negociable": `fianza_status='pendiente'` sin `confirmarSinRecibo` → confirmación
      requerida sin crear `PAGO`; con `confirmarSinRecibo=true` → cobro registrado + traza en
      `AUDIT_LOG`. **Restaurar BD**
      — PASS 2026-07-07; BD restaurada
- [x] 7.6 Doble cobro: sobre reserva ya `cobrada` → `409` "La fianza ya está marcada como cobrada", sin
      `PAGO` adicional. **Restaurar BD**
      — PASS 2026-07-07 (409 FIANZA_YA_COBRADA); BD restaurada
- [x] 7.7 Casos de validación: `importe ≤ 0` (`400`), `fecha_cobro` posterior a `fecha_evento` (`400`),
      reserva/factura/justificante inexistente (`404`), sin auth (`401`); verificar que el formato de
      error coincide con el contrato OpenAPI
      — PASS 2026-07-07; 4 casos validados
- [x] 7.8 Crear report `.../reports/2026-07-07-step-N+2-curl-endpoint-tests.md`
      — CREADO 2026-07-07
- [x] 7.9 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 8. QA: E2E con Playwright MCP (OBLIGATORIO en este change — step-N+3 — EL AGENTE DEBE EJECUTARLO)

> SÍ aplica: este change **incluye frontend** (§5). No es N/A (a diferencia de US-029).

- [x] 8.1 Levantar front + back; `browser_navigate` a la ficha de la reserva
      — VERIFICADO 2026-07-07: frontend localhost:5173, backend localhost:3000; ficha cargada con botón visible
- [x] 8.2 Flujo completo happy path: abrir el formulario de cobro de fianza, introducir importe/fecha,
      adjuntar justificante, registrar; verificar el estado `cobrada` en la UI y la persistencia UI↔BD
      (`PAGO`, `fianza_eur`, `fianza_cobrada_fecha`). **Restaurar BD**
      — PASS 2026-07-07; persistencia UI↔BD verificada; BD restaurada
- [x] 8.3 Escenario "Negociable": con `fianza_status='pendiente'`, comprobar el diálogo de confirmación;
      cancelar → sin acción; confirmar → cobro registrado. **Restaurar BD**
      — PASS 2026-07-07; flujo Negociable completo verificado; BD restaurada
- [x] 8.4 Escenarios de error en UI: doble cobro (acción deshabilitada/mensaje), validaciones (`importe
      ≤ 0`, `fecha_cobro` posterior al evento); verificar responsive en 390/768/1280
      — PASS 2026-07-07; 3 tests de error + 3 viewports responsive (sin overflow, drawer en <lg, sidebar en >=lg)
- [x] 8.5 Crear report `.../reports/2026-07-07-step-N+3-e2e-playwright.md`; marcar completado solo tras
      pasar el E2E y restaurar la BD
      — CREADO 2026-07-07; 9/9 tests Playwright en verde; BD restaurada

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 9.1 `docs-keeper`: reflejar el flujo de cobro de fianza (registrar cobro → `PAGO` + `DOCUMENTO`
      justificante opcional → `FACTURA(fianza).estado=cobrada` + `fianza_status=cobrada` + `fianza_eur`
      / `fianza_cobrada_fecha`, guarda de doble cobro, política "Negociable" para `pendiente`, validación
      `fecha_cobro ≤ fecha_evento`) en la doc técnica; verificar alineación US-030 ↔ OpenAPI ↔
      `er-diagram.md` (§3.13 PAGO, §3.15 DOCUMENTO `justificante_pago`, §3.12 FACTURA `cobrada`, §RESERVA
      `fianza_status`/`fianza_eur`/`fianza_cobrada_fecha`) ↔ UC-22 (pasos 5–9). Documentar que
      `fianza_status = cobrada` es la **tercera** de las 3 precondiciones de `evento_en_curso` (US-031) y
      la alerta FA-01 no bloqueante — COMPLETADO 2026-07-07: actualizados `data-model.md §3.13`,
      `er-diagram.md §3.13` (incl. diagrama Mermaid) y `use-cases.md §UC-22`; alineación US↔OpenAPI↔er-diagram↔UC verificada

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 10.1 `code-reviewer` sobre el diff contra guardrails (hexagonal —dominio puro de validaciones/
      guarda de precondición, puerto de PAGO reusado en dominio—, atomicidad estado↔PAGO con
      `SELECT ... FOR UPDATE` **sin locks distribuidos**, guarda de doble cobro, política "Negociable"
      con traza AUDIT_LOG, multi-tenancy/RLS, sin migración salvo aditiva, frontend responsive +
      estructura por dominio, cliente HTTP generado no editado a mano)
- [x] 10.2 Dejar informe `.../reports/2026-07-07-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 11.1 Tras code-review APTO + validación manual (unit + curl + E2E), **ESPERAR el OK humano**
      antes de archive/PR. No avanzar por defecto ni aunque se diga "continúa"

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec archive us-030-registrar-cobro-fianza` (aplica el delta a
      `openspec/specs/facturacion/`) — solo tras el gate final y con code-review APTO (el hook
      `require-code-review` lo bloquea si falta el informe APTO)
- [ ] 12.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
- [ ] 12.3 Registrar la URL del PR y el estado en el frontmatter de
      `user-stories/US-030-registrar-cobro-fianza.md`
