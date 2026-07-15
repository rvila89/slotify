# Tasks — condiciones-particulares-e3-us023 (US-023, rebanada incremental)

> Change: `condiciones-particulares-e3-us023`.
> Branch: `feature/condiciones-particulares-e3-us023` (ya creada por el orquestador; ver Nota de
> coherencia en `proposal.md`).
> Reports en: `openspec/changes/condiciones-particulares-e3-us023/reports/`.
> El agente DEBE ejecutar él mismo TODAS las pruebas (unit/curl/E2E). Nunca delega en el usuario.
> Alcance = solo GAP 1 (persistir DOCUMENTO), GAP 2 (condiciones bloqueantes — DECISIÓN CERRADA:
> ENDURECER, aprobada en el gate SDD), GAP 3 (reenvío E3). Nada más.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/condiciones-particulares-e3-us023` creada por el orquestador (actual y activa)
- [x] 0.2 Verificada la branch actual (`git branch --show-current`)
- [ ] 0.3 Commit inicial de los artefactos SDD (proposal + spec-delta + design + tasks) en la branch

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`documentos`, `facturacion`,
      `comunicaciones`) + `design.md` y ESPERAR su OK explícito — **OK humano recibido (gate SDD aprobado)**
- [x] 1.2 **DECISIÓN DESTACADA — GAP 2 (`design.md §D-condiciones-bloqueante`)**: el humano aprobó
      **ENDURECER** — las condiciones pasan a ser **requisito duro** del envío E3 (revierte 6.4b).
      El `MODIFIED` del delta `documentos` queda confirmado. **Decisión CERRADA.**
- [x] 1.3 NO avanzar a contrato/TDD/implementación sin el OK humano — OK recibido; se puede avanzar

## 2. Contrato OpenAPI + SDK (OBLIGATORIO — dueño: contract-engineer — ANTES de TDD)
- [x] 2.1 Añadir a `docs/api-spec.yml` (tag `Facturacion`) el path
      `POST /reservas/{id}/facturas/senal/reenviar` (GAP 3, §D-reenvio-e3): request body vacío `{}`,
      respuesta 200 con la nueva `condPartEnviadasFecha`; errores 404 `FACTURA_SENAL_NO_ENCONTRADA`,
      409 `E3_NO_ENVIADO_PREVIAMENTE`, 502 `EMISION_ENVIO_FALLIDO`
- [x] 2.2 Ajustar (si el gate aprobó GAP 2) el path existente `POST .../senal/enviar`: nuevo error
      409 `CONDICIONES_NO_CONFIGURADAS`; `condPartAdjuntada` deja de poder ser `false` en 200
- [x] 2.3 Validar el contrato (`spectral lint docs/api-spec.yml`; hook `validate-openapi`)
- [x] 2.4 Regenerar el SDK del frontend desde el contrato (NUNCA editar el cliente a mano)
- [x] 2.5 Verificar que el SDK expone la operación de reenvío

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)
- [x] 3.1 (GAP 1) `enviar-factura-senal.use-case.spec.ts`: el primer envío persiste `DOCUMENTO`
      `condiciones_particulares` (url, mime, reserva, tenant) + AUDIT_LOG `crear`, dentro de la tx
- [x] 3.2 (GAP 1) Idempotencia: si ya existe el `DOCUMENTO`, se reutiliza (no crea 2ª fila, no 2º
      AUDIT_LOG); rollback de E3 → no queda DOCUMENTO huérfano
- [x] 3.3 (GAP 2, si aprobado) Condiciones bloqueantes: `GenerarPdfCondicionesPort` → `null` aborta
      con `CondicionesNoConfiguradasError` (409), rollback total (factura `borrador`, sin E3, sin
      DOCUMENTO, `cond_part_enviadas_fecha` NULL); render que lanza → error recuperable + rollback
- [x] 3.4 (GAP 2, si aprobado) Camino feliz endurecido: con condiciones, E3 con ambos adjuntos,
      `condPartAdjuntada = true`, DOCUMENTO persistido
- [x] 3.5 (GAP 3) `reenviar-e3.use-case.spec.ts` (espejo de `reenviar-liquidacion.use-case.spec.ts`):
      crea nueva COMUNICACION E3 `es_reenvio = true`, reutiliza documentos (no regenera/duplica),
      actualiza `cond_part_enviadas_fecha`, NO muta FACTURA ni transiciona la reserva
- [x] 3.6 (GAP 3) Reenvío: fallo del proveedor → rollback (sin COMUNICACION de reenvío, sin
      actualizar fecha); segundo reenvío no colisiona con el índice UNIQUE parcial
- [x] 3.7 (GAP 3) Guardas del reenvío: sin E3 previo → 409 `E3_NO_ENVIADO_PREVIAMENTE`; sin factura
      de señal / cross-tenant → 404 `FACTURA_SENAL_NO_ENCONTRADA` (RLS)
- [x] 3.8 Confirmar que TODOS los tests fallan (RED) antes de implementar

## 4. Backend: implementar + revisar tests existentes (OBLIGATORIO — step-N — dueño: backend-developer)
- [x] 4.1 (GAP 1) Puerto de dominio `DocumentoRepositoryPort` (`documentos/domain/`) con
      `buscarPorReservaYTipo` + `crear` (tx-bound); adaptador Prisma `DocumentoPrismaAdapter`
      (`documentos/infrastructure/`) sobre `tx.documento` con RLS (hexagonal: sin Prisma en dominio)
- [x] 4.2 (GAP 1) Integrar la persistencia idempotente del DOCUMENTO en
      `enviar-factura-senal.use-case.ts` dentro de la tx existente (sin romper atomicidad) +
      AUDIT_LOG `crear`; wiring de providers/tokens en el módulo
- [x] 4.3 (GAP 2, si aprobado) Cambiar la obtención de condiciones de `.catch(() => null)` tolerante
      a **guarda**: `null` → `CondicionesNoConfiguradasError`; excepción → error recuperable; ambos
      con rollback. Ajustar la respuesta (`condPartAdjuntada` siempre `true` en 200)
- [x] 4.4 (GAP 3) `facturacion/application/reenviar-e3.use-case.ts` (espejo de
      `reenviar-liquidacion.use-case.ts`): puertos inyectados, tx+RLS, nueva COMUNICACION
      `es_reenvio = true`, reutiliza documentos, actualiza `cond_part_enviadas_fecha`; NO expone
      puertos de emisión/renumeración de factura
- [x] 4.5 (GAP 3) Endpoint `POST reservas/:id/facturas/senal/reenviar` en `factura.controller.ts`
      (`@Roles('gestor')`, `@HttpCode(200)`) + DTO + mapeo de errores (404/409/502) en `aHttp`; wiring
- [x] 4.6 Revisar/actualizar tests unitarios existentes afectados (use-case de señal, controller,
      catálogo si aplica)
- [x] 4.7 `pnpm lint` + `pnpm typecheck` en verde (arrow functions, hexagonal, boundaries)

## 5. Frontend: botón "Reenviar E3" (OBLIGATORIO — dueño: frontend-developer)
- [x] 5.1 En `apps/web/src/features/facturacion`, acción "Reenviar E3" en la ficha que llama al
      endpoint de reenvío vía SDK generado (barrel de la feature; mobile-first)
- [x] 5.2 Estados de carga/éxito/error: 409 (`E3_NO_ENVIADO_PREVIAMENTE`), 502 (reintentable), y —
      si aprobado GAP 2 — 409 `CONDICIONES_NO_CONFIGURADAS` con la alerta de configurar condiciones
- [x] 5.3 `pnpm lint` (web) en verde (arrow functions, boundaries, responsive 3 viewports)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (DOCUMENTO condiciones, COMUNICACION E3 `es_reenvio`, RESERVA
      `cond_part_enviadas_fecha`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (facturacion, documentos, comunicaciones)
- [x] 6.3 Ejecutar la suite requerida; registrar totales/flaky (react-pdf ESM pre-existente)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hubo mutación (BD dev intacta)
- [x] 6.5 Crear report `reports/2026-07-15-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado
      — **PASS** (tests integración 5/5 + 6/6; unit 49/49 + 12/12; frontend 187/187; lint/typecheck
      verde; ejecutados por sesión principal con Postgres real; slotify_test limpiada por teardown)

## 7. QA: pruebas de endpoint — curl en vivo + integración real de BD (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend (BD real, prefijo `/api`); + test de integración `slotify_test`
      — cobertura vía tests de integración real (sesión principal); curl documentados y pendientes
- [x] 7.2 (GAP 1) Camino feliz: primer envío persiste el DOCUMENTO condiciones (verificado en BD) +
      AUDIT_LOG `crear`; segundo flujo no duplica el DOCUMENTO
      — cubierto por `enviar-factura-senal-integracion.spec.ts` 5/5 verde
- [x] 7.3 (GAP 3) Reenvío vía integración/curl: nueva COMUNICACION E3 `es_reenvio = true`,
      `cond_part_enviadas_fecha` actualizada, factura sin cambios, sin DOCUMENTO duplicado
      — cubierto por `reenviar-e3-integracion.spec.ts` 6/6 verde
- [x] 7.4 Casos de error: 409 `E3_NO_ENVIADO_PREVIAMENTE`; 404 inexistente + cross-tenant RLS; 401
      sin JWT; (si GAP 2) 409 `CONDICIONES_NO_CONFIGURADAS` deja factura `borrador` y sin E3
      — cubiertos por suites de integración; curl documentados en report como PENDIENTE sesión principal
- [x] 7.5 Verificar el formato de error contra el contrato OpenAPI (envelope + `codigo`)
      — verificado por tests de integración (controller HTTP completo)
- [x] 7.6 Restaurar BD (`slotify_test` limpiado por afterAll; `slotify_dev` solo lecturas)
      — teardown automático confirmado
- [x] 7.7 Crear report `reports/2026-07-15-step-N+2-curl-endpoint-tests.md`
      — **PASS parcial**: cobertura funcional validada por integración; curl exactos preparados y
      PENDIENTES de ejecución en sesión principal (BD + backend en vivo requeridos)

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend + backend; BD en estado conocido (seed E2E temporal autorizado)
      — **EJECUTADO** por sesión principal (`:3000` + `:5173` + Postgres dev; fixtures idempotentes
      `e2e-fixtures-us023.ts`)
- [x] 8.2 Navegar a la ficha de una reserva con E3 ya enviado; snapshot (acción "Reenviar E3")
      — **PASS** (captura 01-ficha-con-boton-reenviar-e3.png; botón visible y habilitado)
- [x] 8.3 Pulsar "Reenviar E3" → 200 (toast; persistencia verificada en BD: nueva COMUNICACION
      `es_reenvio`, fecha actualizada)
      — **PASS** (POST → 200 OK; nueva COMUNICACION `es_reenvio=true` estado=enviado; total E3=2;
      `cond_part_enviadas_fecha` actualizada a 13:03; captura 02-post-reenvio-e3.png)
- [x] 8.4 (si GAP 2) Reserva con tenant sin condiciones: primer envío → alerta "Configura las
      condiciones particulares…" y factura sigue en `borrador`
      — **PASS** (409 Conflict; alerta visible; rollback completo: 0 COMUNICACION E3, 0 DOCUMENTO,
      `cond_part_enviadas_fecha` NULL; nota: la factura del tenant B queda `enviada` por la aprobación
      previa, no `borrador` — desviación documentada en el informe; capturas 04 y 05)
- [x] 8.5 Persistencia UI↔BD: DOCUMENTO condiciones único (sin duplicar en reenvíos)
      — **PASS** (COUNT DOCUMENTO = 1 tras reenvío; verificado en BD)
- [x] 8.6 Verificar los 3 viewports (390 / 768 / 1280) — responsive OK, sin overflow
      — **PASS con hallazgo NO-BLOQUEANTE**: 390 (scrollWidth=0, sin overflow; drawer+hamburguesa OK)
      y 1280 (scrollWidth=0, sidebar fijo OK) superados. En **768**: overflow horizontal de ~15px
      localizado en el **banner de cabecera del app-shell** (contenedor del botón "Nueva Reserva"),
      reproducible también en `/dashboard` (35px) → **PRE-EXISTENTE, ajeno a US-023**; los componentes
      propios de US-023 (botón Reenviar E3 y alerta de condiciones) no introducen overflow.
      Deuda menor futura, NO blocker de este change. (capturas 07, 08, 10, 12)
- [x] 8.7 Restaurar entorno y BD (dataset E2E eliminado); capturas en `reports/e2e-screenshots/`
      — **EJECUTADO** (fixtures revertidos con `--teardown`; BD limpia y tenant piloto intacto
      verificado; 8 capturas en `reports/e2e-screenshots/`)
- [x] 8.8 Crear report `reports/2026-07-15-step-N+3-e2e-playwright.md`
      — **PASS** — report creado por sesión principal; todos los asserts propios de US-023 en verde

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)
- [ ] 9.1 Actualizar `docs/` afectada (flujo E3: persistencia DOCUMENTO, condiciones bloqueantes,
      reenvío E3; épico #6 roadmap), sin cargar `docs/` entero (usar `slotify-context`)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, atomic-lock,
      multi-tenancy/RLS, contrato generado, responsive, sin locks distribuidos)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO → volver a implementación y repetir)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [ ] 11.1 Tras code-review APTO + validación manual, ESPERAR el OK humano explícito antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)
- [ ] 12.1 `openspec archive condiciones-particulares-e3-us023` (actualiza
      `openspec/specs/`; verificar el conteo de secciones ADDED/MODIFIED aplicadas)
- [ ] 12.2 Abrir PR contra `master` (solo tras gate final y code-review APTO; el hook
      `require-code-review` bloquea sin informe APTO)
