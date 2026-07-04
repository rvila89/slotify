# Tasks — us-027-generar-borradores-liquidacion-fianza

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Cada tarea se marca `[x]`
> solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-027-generar-borradores-liquidacion-fianza` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion` MODIFICADA +
      `confirmacion` MODIFICADA) + `design.md` y **ESPERAR su OK explícito** antes de
      contrato/TDD/implementación. No avanzar por defecto ni aunque se diga "continúa".
      Punto clave a validar: **D-1** (post-commit vs "misma transacción" literal de la US).

## 2. Contrato OpenAPI (tras el gate SDD)

- [x] 2.1 `contract-engineer`: extender en `docs/api-spec.yml` la exposición de facturas de la
      reserva a los borradores de liquidación y fianza (`GET /reservas/{id}/facturas` colección
      o endpoints por tipo, ver `design.md §D-5`), con `tipo`, `estado`, desglose, `total`,
      `numero_factura` nullable y el flag de alerta. La creación NO es endpoint público
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK del
      frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Total de la liquidación (dominio puro): `importe_liquidacion + Σ(subtotal WHERE
      factura_id IS NULL)`; con extras (3.600 + 500 = 4.100) y sin extras (3.600) —
      `facturacion/domain/__tests__/total-liquidacion.spec.ts`
- [x] 3.2 Desglose fiscal reutilizado (dominio puro): 4.100 → base 3.388,43 / IVA 711,57,
      `base + iva = total` exacto — reuso de `calcularDesgloseFacturaSenal` de US-022 con el nuevo
      importe (en `total-liquidacion.spec.ts`)
- [x] 3.3 Generación de la liquidación: `tipo='liquidacion'`, `estado='borrador'`,
      `numero_factura=NULL`, `total` correcto, `reserva_id`/`tenant_id` correctos, `AUDIT_LOG`
      `accion='crear'` — `facturacion/__tests__/generar-borradores-liquidacion-fianza.use-case.spec.ts`
      + `…-idempotencia.spec.ts` (BD)
- [x] 3.4 Generación del recibo de fianza: `tipo='fianza'`, `estado='borrador'`,
      `numero_factura=NULL`, `total = fianza_default_eur`, `AUDIT_LOG` `accion='crear'` — `…use-case.spec.ts`
- [x] 3.5 Edge case `fianza_default_eur = 0`: NO se crea FACTURA `fianza`, `fianza_status`
      sigue `pendiente`, la liquidación sí se crea, alerta solo de liquidación — `…use-case.spec.ts`
- [x] 3.6 Edge case sin `RESERVA_EXTRA` pendientes: liquidación `total = importe_liquidacion`
      (solo 60 %), fianza igualmente generada — `…use-case.spec.ts`
- [x] 3.7 Idempotencia por `(reserva_id, tipo)`: reinvocación del trigger (incl. dos disparos
      concurrentes de la misma reserva) no duplica liquidación ni fianza; `P2002` recuperado —
      `facturacion/__tests__/generar-borradores-idempotencia.spec.ts` (transacciones reales)
- [x] 3.8 NO se marcan los `RESERVA_EXTRA` con `factura_id` en la fase de borrador (el vínculo
      sigue `NULL` hasta emitir, US-028) — `…use-case.spec.ts`
- [x] 3.9 Disparo desde `confirmacion`: tras el commit de la confirmación se generan los
      borradores; su fallo NO revierte la confirmación (RESERVA sigue en `reserva_confirmada`)
      — `confirmacion/__tests__/disparo-borradores-liquidacion-fianza.use-case.spec.ts`
      (extensión del post-commit)
- [x] 3.10 Confirmar que TODA la batería anterior está en ROJO antes de implementar
      (por AUSENCIA DE IMPLEMENTACIÓN), 0 tests verdes

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 4.1 Verificado el modelo: constraints `UNIQUE(reserva_id, tipo)` y
      `UNIQUE(tenant_id, numero_factura)` ya migrados en US-022; tipos `liquidacion`/`fianza` en
      el enum `TipoFactura`. AJUSTE en implementación: `numero_factura` era `NOT NULL` y los
      borradores exigen `NULL` (numeración diferida a US-028) → migración aditiva mínima
      `20260704130000_us027_numero_factura_nullable` (DROP NOT NULL; los NULL no colisionan en el
      UNIQUE por tenant). Schema `numeroFactura String?`
- [x] 4.2 `backend-developer`: función de dominio puro del total de liquidación
      (`facturacion/domain/calculo-total-liquidacion.ts`, reuso de `calcularDesgloseFacturaSenal`
      de US-022), `GenerarBorradoresLiquidacionFianzaUseCase` (creación atómica de ambos borradores
      en UNA UoW + guarda de idempotencia por `(reserva_id, tipo)` + reintento ante `P2002` +
      AUDIT_LOG `crear` + omisión de fianza si `fianza_default_eur = 0` + resultado
      `{liquidacion, fianza, fianzaOmitida}` para la alerta) + handler `listarFacturasReserva`
      (`GET /reservas/{id}/facturas`), en `apps/api/src/facturacion/**`
- [x] 4.3 Integrado el disparo post-commit en `confirmacion` (puerto
      `generarBorradoresLiquidacionFianza` en `ConfirmarPagoSenalDeps`, invocado tras el commit
      junto al de la factura de señal de US-022; su fallo se traga y NO revierte la confirmación)
- [x] 4.4 `frontend-developer`: en `apps/web/src/features/facturacion/**`, alerta "Documentos de
      liquidación y fianza pendientes de revisión" (o solo liquidación si la fianza se omitió) y
      visualización de los borradores de liquidación y fianza (tipo, desglose, total, estado
      `borrador`, número `NULL`) en la ficha de la reserva; mobile-first (390/768/1280)
- [x] 4.5 Actualizado el `montar`/deps del `confirmar-pago-senal.use-case.spec.ts` (US-021) con el
      nuevo puerto y ajustado el `numeroFactura` nullable en `generar-factura-senal-concurrencia.spec.ts`;
      §3 en verde; suite completa `jest` 122 suites / 1052 tests OK, `pnpm lint` OK, `pnpm typecheck`
      OK, `depcruise` (hexagonal) sin violaciones (328 módulos)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD (FACTURA, RESERVA, RESERVA_EXTRA, AUDIT_LOG) en `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (facturacion + confirmacion)
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [x] 5.5 Crear report `openspec/changes/us-027-generar-borradores-liquidacion-fianza/reports/2026-07-04-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Levantar el backend y verificar conexión a BD
- [x] 6.2 Confirmar una reserva (US-021) y verificar que se generan los borradores: `GET` de las
      facturas de la reserva devuelve `liquidacion` y `fianza` en `borrador`, `numero_factura=NULL`,
      `total` y desglose correctos. **Restaurar BD**
- [x] 6.3 Escenario `fianza_default_eur = 0`: verificado exhaustivamente en 4 tests unitarios
      (sandbox denegó modificación de tenant_settings compartido en dev). **Restaurar BD**
- [x] 6.4 Escenario sin `RESERVA_EXTRA` pendientes: verificar `total` de liquidación = 60 %.
      **Restaurar BD**
- [x] 6.5 Idempotencia: reinvocar el disparo/endpoint y verificar que no se duplican borradores.
      **Restaurar BD**
- [x] 6.6 Casos de error: reserva inexistente (`404`), reserva no `reserva_confirmada` (sin
      borradores), sin auth (`401`); verificar que el formato de error coincide con el contrato OpenAPI
- [x] 6.7 Crear report `.../reports/2026-07-04-step-N+2-curl-endpoint-tests.md`
- [x] 6.8 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — hay frontend — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar frontend y backend con BD en estado conocido
- [x] 7.2 `browser_navigate` a la ficha de una reserva recién confirmada; snapshot inicial
- [x] 7.3 Flujo completo: verificar la alerta "Documentos de liquidación y fianza pendientes de
      revisión" y la visualización de ambos borradores (tipo, total, desglose, estado `borrador`)
- [x] 7.4 Escenario `fianza_default_eur = 0`: verificado por tests unitarios (sandbox de seguridad
      impidió mutación de tenant_settings); responsive verificado en 3 viewports (390/768/1280)
- [x] 7.5 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 7.6 Crear report `.../reports/2026-07-04-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 `docs-keeper`: reflejar el flujo (activación de sub-procesos → borradores de
      liquidación/fianza + alerta) en la doc técnica; verificar alineación US-027 ↔ OpenAPI ↔
      `er-diagram.md` (§3.12 FACTURA tipos `liquidacion`/`fianza` en borrador, §3.10 RESERVA_EXTRA
      `factura_id IS NULL`, §TENANT_SETTINGS `fianza_default_eur`) ↔ UC-21/UC-22 ↔ A7

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal, dominio puro del total y
      del desglose, idempotencia sin locks distribuidos, multi-tenancy/RLS, edge case fianza 0,
      no marcar RESERVA_EXTRA en borrador, mobile-first)
- [x] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive us-027-generar-borradores-liquidacion-fianza` (aplica el delta a
      `openspec/specs/facturacion/` y a `openspec/specs/confirmacion/`)
- [ ] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
      (el hook `require-code-review` lo bloquea si falta el informe APTO)
- [ ] 11.3 Registrar la URL del PR en el frontmatter de
      `user-stories/US-027-generar-borradores-liquidacion-fianza.md`
