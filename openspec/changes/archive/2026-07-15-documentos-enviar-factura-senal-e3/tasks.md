# Tasks — documentos-enviar-factura-senal-e3 (6.4b — Bloque C)

> Change: `documentos-enviar-factura-senal-e3`. Branch: `feature/documentos-enviar-factura-senal-e3`.
> Reports en: `openspec/changes/documentos-enviar-factura-senal-e3/reports/`.
> El agente DEBE ejecutar él mismo todas las pruebas (unit/curl/E2E). Nunca delega en el usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/documentos-enviar-factura-senal-e3` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion`, `comunicaciones`,
      `documentos`) + `design.md` (D-ruta-email, D-guarda-estado, D-idempotencia,
      D-endpoint, D-adjunto-condiciones, D-num) y ESPERAR su OK explícito → **OK 2026-07-15**
- [x] 1.2 NO avanzar a contrato/TDD/implementación sin el OK humano (aunque se diga "continúa")

## 2. Contrato OpenAPI + SDK (OBLIGATORIO — dueño: contract-engineer)
- [x] 2.1 Añadir a `docs/api-spec.yml` (tag `Facturacion`) el path
      `POST /reservas/{id}/facturas/senal/enviar` (§D-endpoint): request body vacío `{}`,
      respuesta 200 con la factura de señal emitida + `condPartEnviadasFecha` +
      `condPartAdjuntada`; errores 404 (`FACTURA_SENAL_NO_ENCONTRADA`), 409
      (`FACTURA_SENAL_NO_ENVIABLE` / `E3_YA_ENVIADO`), 502 (`EMISION_ENVIO_FALLIDO`)
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`; hook `validate-openapi`)
- [x] 2.3 Regenerar el SDK del frontend desde el contrato (NUNCA editar el cliente a mano)
- [x] 2.4 Verificar que el SDK expone la nueva operación

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)
- [x] 3.1 `enviar-factura-senal.use-case.spec.ts` (RED): camino feliz (borrador → enviada,
      E3 confirmado, `cond_part_enviadas_fecha` fijada, COMUNICACION E3 + AUDIT_LOG)
- [x] 3.2 Atomicidad/rollback: fallo de E3 → `EmisionEnvioFallidoError`, factura sigue en
      `borrador`, sin COMUNICACION E3 `enviado` (espejo del test de E4)
- [x] 3.3 Guarda de PDF de señal ausente (`pdf_url = null`) → no envía, 502
- [x] 3.4 Guarda de estado: `rechazada` → `FacturaSenalNoEnviableError` (409)
- [x] 3.5 Idempotencia: COMUNICACION E3 `enviado` previa → `E3YaEnviadoError` (409), sin
      re-envío ni duplicado; COMUNICACION E3 `fallido` previa → SÍ permite reintento
- [x] 3.6 Adjunto de condiciones: degrada a `null` o lanza → E3 se envía solo con la señal,
      `condPartAdjuntada = false` + AUDIT_LOG (§D-adjunto-condiciones)
- [x] 3.7 404 si no existe factura de señal / reserva cross-tenant (RLS)
- [x] 3.8 Test de activación de plantilla E3 en `catalogo-plantillas.spec.ts` (activa=true,
      render real, adjuntos requeridos/opcionales)
- [x] 3.9 Confirmar que TODOS los tests fallan (RED) antes de implementar

## 4. Backend: implementar + revisar tests existentes (OBLIGATORIO — step-N — dueño: backend-developer)
- [x] 4.1 `facturacion/application/enviar-factura-senal.use-case.ts` (espejo de
      `aprobar-y-enviar-liquidacion.use-case.ts`): puertos inyectados, tx+RLS, reintento
      `P2002`, envío E3 dentro de la tx con rollback, guardas e idempotencia (hexagonal:
      sin Prisma/`@nestjs`)
- [x] 4.2 Adaptador `EnviarE3EmisionAdapter` (`emision-email.adapter.ts` o hermano) →
      `EnviarEmailPort` directo, `codigoEmail: 'E3'` (§D-ruta-email)
- [x] 4.3 Repos tx-bound de emisión de señal + lectura RESERVA/COMUNICACION E3 + puerto de
      condiciones (`GenerarPdfCondicionesPort.generar(...).catch(() => null)`)
- [x] 4.4 Activar plantilla E3 en `catalogo-plantillas.ts` (render real + adjuntos)
- [x] 4.5 Endpoint `POST reservas/:id/facturas/senal/enviar` en `factura.controller.ts`
      (@Roles('gestor'), @HttpCode(200)) + DTO + mapeo de errores (404/409/502) en `aHttp`
- [x] 4.6 Wiring en el módulo de `facturacion` (providers/tokens)
- [x] 4.7 Revisar/actualizar tests unitarios existentes afectados (catálogo, controller)
- [x] 4.8 `pnpm lint` + `pnpm typecheck` en verde

## 5. Frontend: botón "Enviar factura 40%" (OBLIGATORIO — dueño: frontend-developer)
- [x] 5.1 En `apps/web/src/features/facturacion`, botón "Enviar factura 40%" que llama al
      endpoint vía SDK generado (barrel de la feature; mobile-first)
- [x] 5.2 Estados de carga/éxito/error: 409 (`E3_YA_ENVIADO` / no enviable) y 502
      (reintentable); feedback al usuario
- [x] 5.3 `pnpm lint` (web) en verde (arrow functions, boundaries, responsive)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (FACTURA señal, COMUNICACION E3, RESERVA.cond_part_*)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (facturacion, comunicaciones) → 392/392
- [x] 6.3 Ejecutar la suite requerida; registrar totales/flaky (react-pdf ESM pre-existente)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hubo mutación (BD dev intacta)
- [x] 6.5 Crear report `reports/2026-07-15-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas de endpoint — curl en vivo + integración real de BD (OBLIGATORIO — step-N+2)
- [x] 7.1 Levantar el backend (BD real, prefijo `/api`); + test de integración `slotify_test`
- [x] 7.2 Camino feliz vía integración real: factura `enviada`, COMUNICACION E3 `enviado`,
      `cond_part_enviadas_fecha` fijada, AUDIT_LOG (sustituye al curl para no sembrar BD dev)
- [x] 7.3 Re-disparo → 409 `E3_YA_ENVIADO` (sin duplicado) — verificado en integración
- [x] 7.4 Casos de error: 404 inexistente (curl en vivo) + 404 cross-tenant RLS (integración);
      401 sin JWT (curl); `rechazada`→409 NO alcanzable (enum sin `rechazada`, ver hallazgo)
- [x] 7.5 Verificar el formato de error contra el contrato OpenAPI (envelope + `codigo`)
- [x] 7.6 Restaurar BD (`slotify_test` limpiado por afterAll; `slotify_dev` solo lecturas)
- [x] 7.7 Crear report `reports/2026-07-15-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend + backend; BD en estado conocido (seed E2E temporal autorizado)
- [x] 8.2 Navegar a la ficha de una reserva confirmada; snapshot (botón "Enviar factura 40%")
- [x] 8.3 Pulsar "Enviar factura 40%" → 200 (toast; persistencia verificada en BD)
- [x] 8.4 Re-disparo → aviso inline "ya enviado" (409 `E3_YA_ENVIADO`)
- [x] 8.5 Persistencia UI↔BD: COMUNICACION E3 `enviado` (1, sin duplicar), `cond_part_enviadas_fecha`
- [x] 8.6 Verificar los 3 viewports (390 / 768 / 1280) — responsive OK, sin overflow
- [x] 8.7 Restaurar entorno y BD (dataset E2E eliminado); capturas en `reports/e2e-screenshots/`
- [x] 8.8 Crear report `reports/2026-07-15-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)
- [x] 9.1 Actualizar `docs/` afectada (flujo de facturación/comunicaciones E3, épico #6
      roadmap 6.4b), sin cargar `docs/` entero (usar `slotify-context`)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, atomic-lock,
      multi-tenancy, contrato generado, responsive)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO → volver a implementación y repetir)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, ESPERAR el OK humano explícito antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)
- [ ] 12.1 `openspec archive documentos-enviar-factura-senal-e3` (actualiza `openspec/specs/`)
- [ ] 12.2 Abrir PR contra `master` (solo tras gate final y code-review APTO; el hook
      `require-code-review` bloquea sin informe APTO)
